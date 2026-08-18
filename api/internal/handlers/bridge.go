package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// Bridge (cross-chain mint/burn) read endpoints. Bridge state is low-frequency
// and not mirrored in Postgres, so these read live from the chain's gRPC-gateway
// via the Cosmos client (same pattern as mincast.Quote and denom balance).
//
// The inbound (deposit) and outbound (withdrawal) lists are returned newest
// first; the web app filters them by the connected address client-side.

func (a *API) bridgeQuery(w http.ResponseWriter, r *http.Request, method string, req any) {
	if a.Cosmos == nil {
		writeErr(w, http.StatusNotImplemented, "cosmos layer disabled")
		return
	}
	var resp map[string]any
	if err := a.Cosmos.Query(r.Context(), method, req, &resp); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// pageReq builds a Cosmos pagination request body (uint64 limit serialised as a
// string, optional reverse for newest-first ordering).
func pageReq(limit int, reverse bool) map[string]any {
	return map[string]any{"pagination": map[string]any{"limit": strconv.Itoa(limit), "reverse": reverse}}
}

func (a *API) BridgeParams(w http.ResponseWriter, r *http.Request) {
	a.bridgeQuery(w, r, "energychain.bridge.v1.Query/Params", map[string]any{})
}

func (a *API) BridgeChains(w http.ResponseWriter, r *http.Request) {
	a.bridgeQuery(w, r, "energychain.bridge.v1.Query/Chains", pageReq(200, false))
}

func (a *API) BridgeAssets(w http.ResponseWriter, r *http.Request) {
	a.bridgeQuery(w, r, "energychain.bridge.v1.Query/Assets", pageReq(200, false))
}

func (a *API) BridgeInbounds(w http.ResponseWriter, r *http.Request) {
	a.bridgeQuery(w, r, "energychain.bridge.v1.Query/Inbounds", pageReq(intParam(r, "limit", 200, 1000), true))
}

func (a *API) BridgeOutbounds(w http.ResponseWriter, r *http.Request) {
	a.bridgeQuery(w, r, "energychain.bridge.v1.Query/Outbounds", pageReq(intParam(r, "limit", 200, 1000), true))
}

// BridgeNetBridged returns the net bridged outstanding (minted-burned) for a denom.
func (a *API) BridgeNetBridged(w http.ResponseWriter, r *http.Request) {
	denom := chi.URLParam(r, "denom")
	a.bridgeQuery(w, r, "energychain.bridge.v1.Query/EscrowBalance", map[string]any{"denom": denom})
}
