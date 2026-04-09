Put manuscript .docx files here, OR point the pipeline elsewhere:

- pipeline.config.json → paths.books (relative to repo root or absolute), or
- .env → PIPELINE_BOOKS=absolute\path\to\folder

File names like Title-v3.docx are fine. The pipeline strips the -vN suffix for book_name metadata.
