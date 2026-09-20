-- Complete the deferred validation from 0017 without changing any records.
-- Publish's schema introspection misrenders unvalidated CHECK constraints;
-- a validated constraint produces a valid production schema diff.
ALTER TABLE landing_pages VALIDATE CONSTRAINT landing_pages_url_http;