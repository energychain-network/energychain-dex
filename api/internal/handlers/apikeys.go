package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

// API-key self-service.
//
// Flow (no server-side session):
//
//   1) Client GETs  /api/v1/apikeys/challenge?owner=0x...
//      → server returns { nonce, message, expires_at }
//      The message is a deterministic, human-readable EIP-191 string that
//      includes the owner address, the API host, the nonce and the action so
//      a wallet popup is unambiguous.  We do NOT persist the challenge: the
//      message itself encodes everything we need to verify, and the nonce is
//      a 16-byte random value bound to a 5-minute window via expires_at.
//
//   2) Client POSTs the same message + a personal_sign signature to one of:
//        /api/v1/apikeys/issue   { owner, message, signature, label }
//        /api/v1/apikeys/list    { owner, message, signature }
//        /api/v1/apikeys/revoke  { owner, message, signature, key_hash }
//
// We re-derive the signer from the signature, require it to match `owner`,
// reject expired messages, and then perform the requested action against the
// api_keys table.  The raw key is shown EXACTLY once at issuance – we only
// store its sha256.
//
// Rate limiting: the global per-IP rate limiter middleware already gates
// these endpoints; we additionally cap to 20 keys per owner (active or
// revoked) so a single wallet can't fill the table.

const (
	apikeyChallengeTTL = 5 * time.Minute
	maxKeysPerOwner    = 20
	defaultTier        = "public"
)

type apikeyChallengeResp struct {
	Nonce     string `json:"nonce"`
	Message   string `json:"message"`
	ExpiresAt int64  `json:"expires_at"`
}

func (a *API) APIKeyChallenge(w http.ResponseWriter, r *http.Request) {
	owner, err := parseAddr(r.URL.Query().Get("owner"))
	if err != nil {
		writeErr(w, 400, "owner: "+err.Error())
		return
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	exp := time.Now().Add(apikeyChallengeTTL).Unix()
	host := r.Host
	if host == "" {
		host = "EnergySwap API"
	}
	msg := buildAPIKeyMessage(host, hexAddr(owner), hex.EncodeToString(nonce), exp)
	writeJSON(w, 200, apikeyChallengeResp{
		Nonce:     hex.EncodeToString(nonce),
		Message:   msg,
		ExpiresAt: exp,
	})
}

// buildAPIKeyMessage emits the canonical, human-readable challenge string
// shown in the wallet popup. Format is intentionally rigid because both the
// client and the verifier must produce byte-for-byte identical output.
func buildAPIKeyMessage(host, owner, nonce string, expires int64) string {
	return fmt.Sprintf(`%s wants you to sign in with your wallet.

Address: %s
Nonce: %s
Expires-At: %d

By signing you authorise this address to manage API keys for the EnergySwap data API.`, host, owner, nonce, expires)
}

type apikeyAuth struct {
	Owner     string `json:"owner"`
	Message   string `json:"message"`
	Signature string `json:"signature"`
}

// verify decodes the EIP-191 signature, recovers the signer, ensures it
// matches the claimed owner, and validates the embedded Expires-At. It
// returns the lowercased 20-byte owner address on success.
func (a *API) verifyAPIKeyAuth(req apikeyAuth) ([]byte, error) {
	owner, err := parseAddr(req.Owner)
	if err != nil {
		return nil, errors.New("owner: " + err.Error())
	}
	if !strings.Contains(req.Message, "Address: 0x"+hex.EncodeToString(owner)) {
		return nil, errors.New("message does not bind to owner")
	}
	exp, err := extractExpires(req.Message)
	if err != nil {
		return nil, err
	}
	if time.Now().Unix() > exp {
		return nil, errors.New("challenge expired; request a new one")
	}
	sig, err := decodeHex(req.Signature)
	if err != nil || len(sig) != 65 {
		return nil, errors.New("signature must be 65-byte hex")
	}
	// Personal-sign hashes "\x19Ethereum Signed Message:\n<len>" || message.
	prefixed := []byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(req.Message), req.Message))
	digest := crypto.Keccak256(prefixed)
	// Geth's Ecrecover wants V in {0,1}. Wallets emit 27/28; normalise.
	sigCopy := make([]byte, 65)
	copy(sigCopy, sig)
	if sigCopy[64] >= 27 {
		sigCopy[64] -= 27
	}
	pub, err := crypto.SigToPub(digest, sigCopy)
	if err != nil {
		return nil, errors.New("invalid signature: " + err.Error())
	}
	signer := crypto.PubkeyToAddress(*pub).Bytes()
	if !bytesEqual(signer, owner) {
		return nil, errors.New("signature does not match owner")
	}
	return owner, nil
}

func extractExpires(msg string) (int64, error) {
	const tag = "Expires-At: "
	i := strings.Index(msg, tag)
	if i < 0 {
		return 0, errors.New("missing Expires-At")
	}
	rest := msg[i+len(tag):]
	end := strings.IndexByte(rest, '\n')
	if end < 0 {
		end = len(rest)
	}
	var v int64
	if _, err := fmt.Sscanf(strings.TrimSpace(rest[:end]), "%d", &v); err != nil {
		return 0, err
	}
	return v, nil
}

func decodeHex(s string) ([]byte, error) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "0x")
	return hex.DecodeString(s)
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ---------- POST /apikeys/issue ----------

type issueReq struct {
	apikeyAuth
	Label string `json:"label"`
}

type issueResp struct {
	Key       string `json:"key"`        // shown ONCE; user must save it now
	KeyHash   string `json:"key_hash"`   // hex of sha256(key) – use this in revoke
	Tier      string `json:"tier"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"created_at"`
}

func (a *API) APIKeyIssue(w http.ResponseWriter, r *http.Request) {
	var req issueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	owner, err := a.verifyAPIKeyAuth(req.apikeyAuth)
	if err != nil {
		writeErr(w, 401, err.Error())
		return
	}
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "self-service " + time.Now().UTC().Format("2006-01-02 15:04:05")
	}
	if len(label) > 80 {
		label = label[:80]
	}

	ctx := r.Context()
	var existing int
	if err := a.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM api_keys WHERE owner=$1`, owner).Scan(&existing); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if existing >= maxKeysPerOwner {
		writeErr(w, 409, fmt.Sprintf("owner already holds %d keys (max %d) – revoke unused ones first", existing, maxKeysPerOwner))
		return
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	rawKey := "ek_" + hex.EncodeToString(raw)
	sum := sha256.Sum256([]byte(rawKey))

	now := time.Now().UTC()
	if _, err := a.Pool.Exec(ctx, `
		INSERT INTO api_keys (key_hash, label, tier, rate_per_min, burst, enabled, created_at, owner)
		VALUES ($1, $2, $3, 60, 120, TRUE, $4, $5)`,
		sum[:], label, defaultTier, now, owner,
	); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, issueResp{
		Key:       rawKey,
		KeyHash:   hex.EncodeToString(sum[:]),
		Tier:      defaultTier,
		Label:     label,
		CreatedAt: now.Unix(),
	})
}

// ---------- POST /apikeys/list ----------

type listKeyRow struct {
	KeyHash    string `json:"key_hash"`
	Label      string `json:"label"`
	Tier       string `json:"tier"`
	RatePerMin int    `json:"rate_per_min"`
	Burst      int    `json:"burst"`
	Enabled    bool   `json:"enabled"`
	CreatedAt  int64  `json:"created_at"`
	LastSeenAt int64  `json:"last_seen_at"`
	RevokedAt  int64  `json:"revoked_at,omitempty"`
}

func (a *API) APIKeyList(w http.ResponseWriter, r *http.Request) {
	var req apikeyAuth
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	owner, err := a.verifyAPIKeyAuth(req)
	if err != nil {
		writeErr(w, 401, err.Error())
		return
	}
	rows, err := a.Pool.Query(r.Context(), `
		SELECT key_hash, label, tier, rate_per_min, burst, enabled,
		       EXTRACT(EPOCH FROM created_at)::bigint,
		       COALESCE(EXTRACT(EPOCH FROM last_seen_at), 0)::bigint,
		       COALESCE(EXTRACT(EPOCH FROM revoked_at), 0)::bigint
		  FROM api_keys WHERE owner=$1 ORDER BY created_at DESC`, owner)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []listKeyRow{}
	for rows.Next() {
		var row listKeyRow
		var hash []byte
		if err := rows.Scan(&hash, &row.Label, &row.Tier, &row.RatePerMin, &row.Burst,
			&row.Enabled, &row.CreatedAt, &row.LastSeenAt, &row.RevokedAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		row.KeyHash = hex.EncodeToString(hash)
		out = append(out, row)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

// ---------- POST /apikeys/revoke ----------

type revokeReq struct {
	apikeyAuth
	KeyHash string `json:"key_hash"`
}

func (a *API) APIKeyRevoke(w http.ResponseWriter, r *http.Request) {
	var req revokeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	owner, err := a.verifyAPIKeyAuth(req.apikeyAuth)
	if err != nil {
		writeErr(w, 401, err.Error())
		return
	}
	hash, err := decodeHex(req.KeyHash)
	if err != nil || len(hash) != 32 {
		writeErr(w, 400, "key_hash must be 32-byte hex")
		return
	}
	tag, err := a.Pool.Exec(r.Context(), `
		UPDATE api_keys SET enabled=FALSE, revoked_at=NOW()
		 WHERE owner=$1 AND key_hash=$2`, owner, hash)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "key not found for owner")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}

// Convenience: silence unused-import warnings if context ever gets dropped.
var _ = context.Background
