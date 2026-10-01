ALTER TABLE arclattice.document_wiki_link
ADD CONSTRAINT document_wiki_link_positive_version CHECK(version > 0);
