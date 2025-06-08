# Legacy Migrations Archive

This directory contains the original 23 migration files (0001-0023, with 0016 missing) that were used to build the Jeffers database schema incrementally.

## Why These Were Archived

On January 6, 2025, we performed a full migration squash to address several issues:

1. **Duplicate Migration Numbers**: Migrations 0021_add_chunking_status_to_ingestion_jobs.sql and 0021_rename_key_topics_to_tags.sql both had the same number
2. **Missing Migration**: Migration 0016 was missing from the sequence
3. **Poor Initial Planning**: Many migrations were adding fields to existing tables, suggesting the schema wasn't well-planned initially
4. **Technical Debt**: Late-stage renaming and restructuring indicated evolving requirements

## Current State

The entire schema has been consolidated into a single migration:
- `/models/migrations/0001_initial_schema.sql`

This consolidated migration:
- Represents the complete schema after all 23 migrations
- Fixes timestamp format inconsistencies
- Removes deprecated columns
- Adds comprehensive documentation
- Provides a clean starting point for new installations

## Historical Reference

These legacy migrations are kept for:
- Understanding the evolution of the schema
- Debugging issues in existing deployments (though none exist)
- Historical documentation of design decisions

## DO NOT USE THESE MIGRATIONS

These files are archived for reference only. All new installations should use the consolidated migration.