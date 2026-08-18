package cosmosrunner

import "strconv"

// The Cosmos gRPC-gateway marshals uint64/int64 as quoted JSON strings and
// enums as their proto names, so every numeric field below is a string.

// --- pagination ------------------------------------------------------------

type pageReq struct {
	Pagination pageReqInner `json:"pagination"`
}
type pageReqInner struct {
	Key   string `json:"key,omitempty"`
	Limit string `json:"limit,omitempty"`
}
type pageResp struct {
	NextKey string `json:"next_key"`
	Total   string `json:"total"`
}

// --- stableusd -------------------------------------------------------------

type stableDenom struct {
	Id                  string   `json:"id"`
	Symbol              string   `json:"symbol"`
	Decimals            int      `json:"decimals"`
	PegCurrency         string   `json:"peg_currency"`
	Admin               string   `json:"admin"`
	Minters             []string `json:"minters"`
	Status              string   `json:"status"`
	ReserveTopic        string   `json:"reserve_topic"`
	RequiredRatioBps    int      `json:"required_ratio_bps"`
	MaxStalenessSeconds string   `json:"max_staleness_seconds"`
	PolicyId            string   `json:"policy_id"`
	CreatedAt           string   `json:"created_at"`
	UpdatedAt           string   `json:"updated_at"`
}
type denomsResp struct {
	Denoms     []stableDenom `json:"denoms"`
	Pagination pageResp      `json:"pagination"`
}
type supplyResp struct {
	Amount string `json:"amount"`
}
type stableRedemption struct {
	Id         string `json:"id"`
	DenomId    string `json:"denom_id"`
	Holder     string `json:"holder"`
	Amount     string `json:"amount"`
	Status     string `json:"status"`
	Memo       string `json:"memo"`
	CreatedAt  string `json:"created_at"`
	ResolvedAt string `json:"resolved_at"`
}
type stableRedemptionRow struct {
	Redemption stableRedemption `json:"redemption"`
}

// --- rwatoken --------------------------------------------------------------

type rwaToken struct {
	Id                     string `json:"id"`
	Symbol                 string `json:"symbol"`
	Name                   string `json:"name"`
	Admin                  string `json:"admin"`
	AssetClass             string `json:"asset_class"`
	Decimals               int    `json:"decimals"`
	TotalSupply            string `json:"total_supply"`
	Status                 string `json:"status"`
	SettlementDenom        string `json:"settlement_denom"`
	PolicyId               string `json:"policy_id"`
	RequireKyc             bool   `json:"require_kyc"`
	RedemptionPrice        string `json:"redemption_price"`
	RedemptionDelaySeconds string `json:"redemption_delay_seconds"`
	PerHolderCap           string `json:"per_holder_cap"`
	MetadataUri            string `json:"metadata_uri"`
	CreatedAt              string `json:"created_at"`
	UpdatedAt              string `json:"updated_at"`
}
type tokensResp struct {
	Tokens     []rwaToken `json:"tokens"`
	Pagination pageResp   `json:"pagination"`
}
type poolBalanceResp struct {
	Denom  string `json:"denom"`
	Amount string `json:"amount"`
}
type rwaDistribution struct {
	Id            string `json:"id"`
	TokenId       string `json:"token_id"`
	SnapshotId    string `json:"snapshot_id"`
	Denom         string `json:"denom"`
	TotalAmount   string `json:"total_amount"`
	ClaimedAmount string `json:"claimed_amount"`
	CreatedAt     string `json:"created_at"`
}
type rwaSnapshot struct {
	Id          string `json:"id"`
	TokenId     string `json:"token_id"`
	TotalSupply string `json:"total_supply"`
	TakenAt     string `json:"taken_at"`
	HolderCount uint32 `json:"holder_count"`
}
type rwaSnapshotRow struct {
	Snapshot rwaSnapshot `json:"snapshot"`
}
type rwaDistributionRow struct {
	Distribution rwaDistribution `json:"distribution"`
}
type rwaRedemption struct {
	Id           string `json:"id"`
	TokenId      string `json:"token_id"`
	Holder       string `json:"holder"`
	Units        string `json:"units"`
	Denom        string `json:"denom"`
	Payout       string `json:"payout"`
	Status       string `json:"status"`
	RequestedAt  string `json:"requested_at"`
	ExecuteAfter string `json:"execute_after"`
	ResolvedAt   string `json:"resolved_at"`
}
type rwaRedemptionRow struct {
	Redemption rwaRedemption `json:"redemption"`
}

// --- market (order book) ---------------------------------------------------

type market struct {
	Id                string `json:"id"`
	BaseDenom         string `json:"base_denom"`
	QuoteDenom        string `json:"quote_denom"`
	Status            string `json:"status"`
	FeeBps            int    `json:"fee_bps"`
	MinBaseQty        string `json:"min_base_qty"`
	BatchInterval     string `json:"batch_interval"`
	LastBatchTime     string `json:"last_batch_time"`
	LastClearingPrice string `json:"last_clearing_price"`
	CreatedAt         string `json:"created_at"`
	RequireKyc        bool   `json:"require_kyc"`
	PolicyId          string `json:"policy_id"`
	Operator          string `json:"operator"`
	BondAmount        string `json:"bond_amount"`
	BondDenom         string `json:"bond_denom"`
}
type marketsResp struct {
	Markets    []market `json:"markets"`
	Pagination pageResp `json:"pagination"`
}
type order struct {
	Id        string `json:"id"`
	MarketId  string `json:"market_id"`
	Owner     string `json:"owner"`
	Side      string `json:"side"`
	Price     string `json:"price"`
	Quantity  string `json:"quantity"`
	Filled    string `json:"filled"`
	Escrowed  string `json:"escrowed"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	Seq       string `json:"seq"`
}
type orderBookResp struct {
	Buys  []order `json:"buys"`
	Sells []order `json:"sells"`
}

// --- mincast ---------------------------------------------------------------

type mincastMarket struct {
	Id              string `json:"id"`
	Denom           string `json:"denom"`
	Name            string `json:"name"`
	Admin           string `json:"admin"`
	SettlementDenom string `json:"settlement_denom"`
	Treasury        string `json:"treasury"`
	Supply          string `json:"supply"`
	InitialPrice    string `json:"initial_price"`
	MintFeeBps      int    `json:"mint_fee_bps"`
	MeltFeeBps      int    `json:"melt_fee_bps"`
	FloorPrice      string `json:"floor_price"`
	Status          string `json:"status"`
	PolicyId        string `json:"policy_id"`
	RequireKyc      bool   `json:"require_kyc"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}
type mincastMarketsResp struct {
	Markets    []mincastMarket `json:"markets"`
	Pagination pageResp        `json:"pagination"`
}
type rewardPoolResp struct {
	Balance string `json:"balance"`
}
type invest struct {
	Id             string `json:"id"`
	MarketId       string `json:"market_id"`
	Investor       string `json:"investor"`
	PrincipalUnits string `json:"principal_units"`
	Yield          string `json:"yield"`
	ApyBps         int    `json:"apy_bps"`
	OpenedAt       string `json:"opened_at"`
	Maturity       string `json:"maturity"`
	Status         string `json:"status"`
	ResolvedAt     string `json:"resolved_at"`
}
type investRow struct {
	Invest invest `json:"invest"`
}

// --- offering --------------------------------------------------------------

type offering struct {
	Id                string `json:"id"`
	TokenId           string `json:"token_id"`
	Issuer            string `json:"issuer"`
	Denom             string `json:"denom"`
	UnitPrice         string `json:"unit_price"`
	SoftCap           string `json:"soft_cap"`
	HardCap           string `json:"hard_cap"`
	Raised            string `json:"raised"`
	StartTime         string `json:"start_time"`
	EndTime           string `json:"end_time"`
	Status            string `json:"status"`
	TotalTranches     int    `json:"total_tranches"`
	ReleasedTranches  int    `json:"released_tranches"`
	ReleasedAmount    string `json:"released_amount"`
	InjectionsDone    int    `json:"injections_done"`
	InjectedTotal     string `json:"injected_total"`
	RequiredInjection string `json:"required_injection"`
	InjectionInterval string `json:"injection_interval"`
	AllocatedUnits    string `json:"allocated_units"`
	DefaultTreasury   string `json:"default_treasury"`
	SucceededAt       string `json:"succeeded_at"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}
type offeringsResp struct {
	Offerings  []offering `json:"offerings"`
	Pagination pageResp   `json:"pagination"`
}
type subscription struct {
	OfferingId     string `json:"offering_id"`
	Investor       string `json:"investor"`
	Contributed    string `json:"contributed"`
	Units          string `json:"units"`
	Allocated      bool   `json:"allocated"`
	ReturnsClaimed string `json:"returns_claimed"`
	Refunded       bool   `json:"refunded"`
}
type subscriptionsResp struct {
	Subscriptions []subscription `json:"subscriptions"`
	Pagination    pageResp       `json:"pagination"`
}
type subscriptionRow struct {
	Subscription subscription `json:"subscription"`
}
type treasuryResp struct {
	Denom       string `json:"denom"`
	Treasury    string `json:"treasury"`
	ReturnsPool string `json:"returns_pool"`
}

// --- identity --------------------------------------------------------------

type idAccount struct {
	Address      string `json:"address"`
	Did          string `json:"did"`
	KycCleared   bool   `json:"kyc_cleared"`
	Accredited   bool   `json:"accredited"`
	Jurisdiction string `json:"jurisdiction"`
	KycExpiresAt string `json:"kyc_expires_at"`
	Status       string `json:"status"`
	Registrar    string `json:"registrar"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}
type accountsResp struct {
	Accounts   []idAccount `json:"accounts"`
	Pagination pageResp    `json:"pagination"`
}
type idPolicy struct {
	Id                   string   `json:"id"`
	Description          string   `json:"description"`
	RequireKyc           bool     `json:"require_kyc"`
	RequireAccredited    bool     `json:"require_accredited"`
	DenyFrozen           bool     `json:"deny_frozen"`
	AllowedJurisdictions []string `json:"allowed_jurisdictions"`
	DeniedJurisdictions  []string `json:"denied_jurisdictions"`
	Paused               bool     `json:"paused"`
	Owner                string   `json:"owner"`
	CreatedAt            string   `json:"created_at"`
	UpdatedAt            string   `json:"updated_at"`
}
type policiesResp struct {
	Policies   []idPolicy `json:"policies"`
	Pagination pageResp   `json:"pagination"`
}

// --- assethub --------------------------------------------------------------

type provider struct {
	Address     string `json:"address"`
	Role        string `json:"role"`
	DisplayName string `json:"display_name"`
	Bond        string `json:"bond"`
	Status      string `json:"status"`
	Infractions int    `json:"infractions"`
	JailedUntil string `json:"jailed_until"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}
type providersResp struct {
	Providers  []provider `json:"providers"`
	Pagination pageResp   `json:"pagination"`
}
type device struct {
	Id              string `json:"id"`
	Operator        string `json:"operator"`
	DeviceType      string `json:"device_type"`
	Pubkey          string `json:"pubkey"`
	Jurisdiction    string `json:"jurisdiction"`
	AttestationHash string `json:"attestation_hash"`
	Firmware        string `json:"firmware"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}
type devicesResp struct {
	Devices    []device `json:"devices"`
	Pagination pageResp `json:"pagination"`
}
type reading struct {
	Id               string `json:"id"`
	DeviceId         string `json:"device_id"`
	PeriodStart      string `json:"period_start"`
	PeriodEnd        string `json:"period_end"`
	Unit             string `json:"unit"`
	IotValue         string `json:"iot_value"`
	OperationalValue string `json:"operational_value"`
	Verified         bool   `json:"verified"`
	SubmittedBy      string `json:"submitted_by"`
	SubmittedAt      string `json:"submitted_at"`
}
type readingsResp struct {
	Readings   []reading `json:"readings"`
	Pagination pageResp  `json:"pagination"`
}
type topic struct {
	Id          string `json:"id"`
	Description string `json:"description"`
	MinSources  int    `json:"min_sources"`
	Value       string `json:"value"`
	SourceCount int    `json:"source_count"`
	HasValue    bool   `json:"has_value"`
	UpdatedAt   string `json:"updated_at"`
}
type topicsResp struct {
	Topics     []topic  `json:"topics"`
	Pagination pageResp `json:"pagination"`
}

// --- helpers ---------------------------------------------------------------

// parseU parses a decimal string into uint64 (0 on empty/error). Used for
// BIGINT id/time columns.
func parseU(s string) uint64 {
	if s == "" {
		return 0
	}
	n, _ := strconv.ParseUint(s, 10, 64)
	return n
}

// num0 normalises a numeric string for a NUMERIC column, defaulting to "0".
func num0(s string) string {
	if s == "" {
		return "0"
	}
	return s
}
