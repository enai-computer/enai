# Feature: [Feature Name]

**Priority:** [High | Medium | Low]
**Target Release:** [Version or date]
**Epic/Issue:** [Link to tracking issue]

## Summary
[1-2 sentence description of what this feature does for users]

## User Stories
```
As a [user type]
I want to [action]
So that [benefit]
```

## Requirements

### Must Have
- [ ] [Core requirement 1]
- [ ] [Core requirement 2]

### Nice to Have
- [ ] [Additional feature 1]
- [ ] [Additional feature 2]

## Technical Approach
[Brief description of implementation strategy]

### Components Affected
- **Models:** [List affected models]
- **Services:** [List affected services]
- **UI:** [List UI components]
- **IPC:** [List IPC channels]

### Data Changes
[Database migrations or schema changes needed]

## Success Criteria
- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]

## Open Questions
- [ ] [Question that needs answering]
- [ ] [Technical decision to be made]

---

# Example: Feature: PDF Ingestion

**Priority:** High
**Target Release:** v0.2.0
**Epic/Issue:** #45

## Summary
Allow users to upload and ingest PDF files into their notebooks, extracting text and preserving document structure for AI-powered search and analysis.

## User Stories
```
As a researcher
I want to upload PDF papers to my notebook
So that I can search and reference them alongside my notes
```

## Requirements

### Must Have
- [ ] Upload PDF via drag-and-drop or file picker
- [ ] Extract text content preserving paragraphs
- [ ] Store PDF metadata (title, author, page count)
- [ ] Show upload progress
- [ ] Handle upload errors gracefully

### Nice to Have
- [ ] Extract images from PDFs
- [ ] Preserve formatting (bold, italic)
- [ ] OCR support for scanned PDFs

## Technical Approach
Use pdf-parse library in a separate worker thread to avoid blocking the UI. Store extracted content in Objects table with pdf-specific metadata.

### Components Affected
- **Models:** ObjectModel (new pdf_metadata field)
- **Services:** New PdfIngestionService
- **UI:** PdfUploadDialog component
- **IPC:** IPC_CHANNELS.PDF_UPLOAD

### Data Changes
```sql
ALTER TABLE objects ADD COLUMN pdf_metadata TEXT;
-- Store JSON: {pageCount, author, title, createdDate}
```

## Success Criteria
- [ ] Can upload 50MB PDFs without UI freeze
- [ ] Text extraction completes within 30s for typical papers
- [ ] Extracted text is searchable immediately

## Open Questions
- [ ] Should we limit PDF size? (Currently thinking 100MB)
- [ ] How to handle password-protected PDFs?