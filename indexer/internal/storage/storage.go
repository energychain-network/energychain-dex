package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 16
	cfg.MinConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Pool() *pgxpool.Pool { return s.pool }
func (s *Store) Close()              { s.pool.Close() }

// SaveCursor records the most recently confirmed block per stream so that
// restarts resume in O(1) and reorg detection can compare parent hashes.
func (s *Store) SaveCursor(ctx context.Context, stream string, height int64, blockHash []byte) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO indexer_cursor (stream, height, block_hash, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (stream) DO UPDATE
			SET height = EXCLUDED.height,
			    block_hash = EXCLUDED.block_hash,
			    updated_at = NOW()`,
		stream, height, blockHash)
	return err
}

// SaveCursorTx writes the cursor inside an existing transaction. Used during
// reorg rewind so the cursor move and the data deletes commit atomically.
func (s *Store) SaveCursorTx(ctx context.Context, tx pgx.Tx, stream string, height int64, blockHash []byte) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO indexer_cursor (stream, height, block_hash, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (stream) DO UPDATE
			SET height = EXCLUDED.height,
			    block_hash = EXCLUDED.block_hash,
			    updated_at = NOW()`,
		stream, height, blockHash)
	return err
}

func (s *Store) Cursor(ctx context.Context, stream string) (int64, []byte, error) {
	var h int64
	var hash []byte
	err := s.pool.QueryRow(ctx, `SELECT height, block_hash FROM indexer_cursor WHERE stream=$1`, stream).Scan(&h, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, nil
	}
	return h, hash, err
}
