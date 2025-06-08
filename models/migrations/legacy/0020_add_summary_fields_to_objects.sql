-- Migration: Add summary, propositions, and key topics fields to objects table
-- Purpose: Support object-level summaries for all content types (PDFs, URLs, etc.)
-- Date: 2025-05-30

-- Add summary field for object-level summary
ALTER TABLE objects ADD COLUMN summary TEXT;

-- Add propositions field (JSON array of key claims/facts)
ALTER TABLE objects ADD COLUMN propositions_json TEXT;

-- Add key topics field (JSON array of main topics/themes)
ALTER TABLE objects ADD COLUMN key_topics_json TEXT;

-- Add timestamp for when summary was generated
ALTER TABLE objects ADD COLUMN summary_generated_at TEXT;

-- Create index on summary_generated_at for batch processing queries
CREATE INDEX idx_objects_summary_generated_at ON objects(summary_generated_at);

-- Update existing PDF objects to migrate data from ai_generated_metadata
-- This ensures backwards compatibility for existing PDFs
UPDATE objects 
SET 
    summary = json_extract(ai_generated_metadata, '$.summary'),
    key_topics_json = json_extract(ai_generated_metadata, '$.tags'),
    summary_generated_at = created_at
WHERE 
    object_type = 'pdf_document' 
    AND ai_generated_metadata IS NOT NULL
    AND json_extract(ai_generated_metadata, '$.summary') IS NOT NULL;