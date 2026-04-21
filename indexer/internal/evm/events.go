package evm

import (
	"encoding/hex"
	"math/big"

	"golang.org/x/crypto/sha3"
)

// keccak256 returns the EVM keccak256 hash of input.
func keccak256(in []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(in)
	return h.Sum(nil)
}

// Topic computes the 32-byte event signature topic for the given canonical
// signature, e.g. "Swap(address,uint256,uint256,uint256,uint256,address)".
func Topic(sig string) []byte { return keccak256([]byte(sig)) }

var (
	TopicPairCreated = Topic("PairCreated(address,address,address,uint256)")
	TopicMint        = Topic("Mint(address,uint256,uint256)")
	TopicBurn        = Topic("Burn(address,uint256,uint256,address)")
	TopicSwap        = Topic("Swap(address,uint256,uint256,uint256,uint256,address)")
	TopicSync        = Topic("Sync(uint112,uint112)")
	TopicTransfer    = Topic("Transfer(address,address,uint256)")
)

// HexTopic renders a topic as "0x..." for use in eth_getLogs filter params.
func HexTopic(t []byte) string { return "0x" + hex.EncodeToString(t) }

// AddressFromTopic extracts the trailing 20 bytes of an indexed address topic.
func AddressFromTopic(t []byte) []byte {
	if len(t) < 20 {
		return nil
	}
	return t[len(t)-20:]
}

// DecodeUint256 reads a 32-byte big-endian word from data[off:off+32].
func DecodeUint256(data []byte, off int) *big.Int {
	if off+32 > len(data) {
		return new(big.Int)
	}
	return new(big.Int).SetBytes(data[off : off+32])
}

// PairCreated event payload (Factory).
type PairCreatedEvent struct {
	Token0    []byte
	Token1    []byte
	Pair      []byte
	PairIndex *big.Int
}

func DecodePairCreated(l Log) *PairCreatedEvent {
	if len(l.Topics) != 3 || len(l.Data) < 64 {
		return nil
	}
	return &PairCreatedEvent{
		Token0:    AddressFromTopic(l.Topics[1]),
		Token1:    AddressFromTopic(l.Topics[2]),
		Pair:      AddressFromTopic(l.Data[0:32]),
		PairIndex: DecodeUint256(l.Data, 32),
	}
}

// Pair event payloads.
type SyncEvent struct {
	Reserve0 *big.Int
	Reserve1 *big.Int
}

func DecodeSync(l Log) *SyncEvent {
	if len(l.Data) < 64 {
		return nil
	}
	return &SyncEvent{
		Reserve0: DecodeUint256(l.Data, 0),
		Reserve1: DecodeUint256(l.Data, 32),
	}
}

type SwapEvent struct {
	Sender     []byte
	To         []byte
	Amount0In  *big.Int
	Amount1In  *big.Int
	Amount0Out *big.Int
	Amount1Out *big.Int
}

func DecodeSwap(l Log) *SwapEvent {
	if len(l.Topics) != 3 || len(l.Data) < 128 {
		return nil
	}
	return &SwapEvent{
		Sender:     AddressFromTopic(l.Topics[1]),
		To:         AddressFromTopic(l.Topics[2]),
		Amount0In:  DecodeUint256(l.Data, 0),
		Amount1In:  DecodeUint256(l.Data, 32),
		Amount0Out: DecodeUint256(l.Data, 64),
		Amount1Out: DecodeUint256(l.Data, 96),
	}
}

type MintEvent struct {
	Sender  []byte
	Amount0 *big.Int
	Amount1 *big.Int
}

func DecodeMint(l Log) *MintEvent {
	if len(l.Topics) != 2 || len(l.Data) < 64 {
		return nil
	}
	return &MintEvent{
		Sender:  AddressFromTopic(l.Topics[1]),
		Amount0: DecodeUint256(l.Data, 0),
		Amount1: DecodeUint256(l.Data, 32),
	}
}

type BurnEvent struct {
	Sender  []byte
	To      []byte
	Amount0 *big.Int
	Amount1 *big.Int
}

func DecodeBurn(l Log) *BurnEvent {
	if len(l.Topics) != 3 || len(l.Data) < 64 {
		return nil
	}
	return &BurnEvent{
		Sender:  AddressFromTopic(l.Topics[1]),
		To:      AddressFromTopic(l.Topics[2]),
		Amount0: DecodeUint256(l.Data, 0),
		Amount1: DecodeUint256(l.Data, 32),
	}
}

type TransferEvent struct {
	From   []byte
	To     []byte
	Amount *big.Int
}

func DecodeTransfer(l Log) *TransferEvent {
	if len(l.Topics) != 3 || len(l.Data) < 32 {
		return nil
	}
	return &TransferEvent{
		From:   AddressFromTopic(l.Topics[1]),
		To:     AddressFromTopic(l.Topics[2]),
		Amount: DecodeUint256(l.Data, 0),
	}
}
