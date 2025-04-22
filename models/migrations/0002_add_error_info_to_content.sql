-- Adds a nullable column to capture processing errors
ALTER TABLE content
  ADD COLUMN error_info TEXT; 