const MarkdownIt = require('markdown-it');
const grayMatter = require('gray-matter');

/**
 * HeaderExtractor - Extracts headers and previews from markdown documents
 *
 * Purpose: Create compact summaries by capturing section structure and first few lines
 * Usage: Both Task Context Skill and GSD Doc Compression modules
 */
class HeaderExtractor {
  constructor() {
    this.md = new MarkdownIt();
  }

  /**
   * Extract paragraphs scored by term overlap with a query context string.
   * Returns the top-scoring paragraphs up to maxChars total.
   * Falls back to first-N-chars extraction when queryContext is empty.
   *
   * @param {string} content - Section body text (plain text, may contain markdown)
   * @param {string} queryContext - Search terms or query string from hook input
   * @param {number} maxChars - Max chars to return (default 300)
   * @returns {string} Selected preview text
   */
  selectiveExtract(content, queryContext, maxChars = 300) {
    if (!queryContext || queryContext.trim().length === 0) {
      // No query context — fall back to structural (first N chars)
      return content.substring(0, maxChars);
    }

    // Tokenize query into terms (lowercase, split on non-word chars, remove short words)
    const queryTerms = queryContext
      .toLowerCase()
      .split(/\W+/)
      .filter(t => t.length >= 3);

    if (queryTerms.length === 0) {
      return content.substring(0, maxChars);
    }

    // Split content into candidate paragraphs (blank-line separated)
    const paragraphs = content
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (paragraphs.length === 0) {
      return content.substring(0, maxChars);
    }

    // Score each paragraph by term overlap (preserve original index for stable sort on ties)
    const scored = paragraphs.map((para, idx) => {
      const paraLower = para.toLowerCase();
      const matchCount = queryTerms.filter(term => paraLower.includes(term)).length;
      const score = matchCount / queryTerms.length;
      return { para, score, idx };
    });

    // Sort by score descending, original order as tiebreaker
    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

    // Collect top paragraphs up to maxChars
    let result = '';
    for (const { para } of scored) {
      if (result.length === 0) {
        // Always include at least one paragraph (truncate if necessary)
        result = para.substring(0, maxChars);
        if (result.length >= maxChars) break;
      } else if (result.length + 2 + para.length <= maxChars) {
        result += '\n\n' + para;
      }
    }

    return result || content.substring(0, maxChars);
  }

  /**
   * Extract summary from markdown content
   * @param {string} markdownContent - Full markdown document
   * @param {string} absolutePath - Absolute file path for reference link
   * @param {string} [queryContext] - Optional query context for semantic paragraph scoring
   * @returns {Object} { summary, sections, frontmatter }
   */
  extractSummary(markdownContent, absolutePath, queryContext = '') {
    // Handle empty content edge case
    if (!markdownContent || markdownContent.trim().length === 0) {
      return {
        summary: `**Full documentation:** [View complete file](file://${absolutePath})`,
        sections: 0,
        frontmatter: {}
      };
    }

    // Parse frontmatter and content separately
    const { data: frontmatter, content } = grayMatter(markdownContent);

    // Tokenize markdown content
    const tokens = this.md.parse(content, {});

    // Build summary
    let summaryParts = [];
    let sectionCount = 0;

    // Add frontmatter if present
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      summaryParts.push('---');
      for (const [key, value] of Object.entries(frontmatter)) {
        if (Array.isArray(value)) {
          summaryParts.push(`${key}: [${value.join(', ')}]`);
        } else if (typeof value === 'object') {
          summaryParts.push(`${key}: ${JSON.stringify(value)}`);
        } else {
          summaryParts.push(`${key}: ${value}`);
        }
      }
      summaryParts.push('---');
      summaryParts.push('');
    }

    // Handle case where there are no headers
    if (!tokens.some(t => t.type === 'heading_open')) {
      if (content.length < 500) {
        // Short content without headers - return as-is
        summaryParts.push(content);
      } else {
        // Long content without headers — use selective extract
        summaryParts.push(this.selectiveExtract(content, queryContext, 500) + (content.length > 500 ? '...' : ''));
      }
      summaryParts.push('');
      summaryParts.push(`**Full documentation:** [View complete file](file://${absolutePath})`);

      return {
        summary: summaryParts.join('\n'),
        sections: 0,
        frontmatter
      };
    }

    // Process tokens to extract headers and previews
    let currentHeader = null;
    let currentLevel = 0;
    let captureContent = false;
    let inCodeBlock = false;
    // Accumulate section body lines for selective extraction
    let sectionBodyLines = [];
    let bulletCount = 0;
    const MAX_PREVIEW_CHARS = 300;
    const MAX_BULLETS = 3;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Track code blocks to skip inline content
      if (token.type === 'fence') {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // Process headers
      if (token.type === 'heading_open') {
        // Save previous section if any
        if (currentHeader) {
          const sectionBody = sectionBodyLines.join('\n\n');
          const preview = this.selectiveExtract(sectionBody, queryContext, MAX_PREVIEW_CHARS);
          this._addSection(summaryParts, currentHeader, currentLevel, preview ? [preview] : []);
          sectionCount++;
        }

        // Start new section
        currentLevel = parseInt(token.tag.substring(1)); // h1 -> 1, h2 -> 2, etc.
        const nextToken = tokens[i + 1];
        if (nextToken && nextToken.type === 'inline') {
          currentHeader = nextToken.content;
        }
        captureContent = true;
        sectionBodyLines = [];
        bulletCount = 0;
        continue;
      }

      // Capture content after header (until we hit next header)
      if (captureContent && !inCodeBlock) {
        if (token.type === 'paragraph_open') {
          // Next token should be inline content
          const nextToken = tokens[i + 1];
          if (nextToken && nextToken.type === 'inline') {
            sectionBodyLines.push(nextToken.content);
          }
        } else if (token.type === 'bullet_list_open') {
          // Capture bullets after header
          const bulletLines = [];
          for (let j = i + 1; j < tokens.length && bulletLines.length < MAX_BULLETS; j++) {
            const bulletToken = tokens[j];
            if (bulletToken.type === 'bullet_list_close') break;
            if (bulletToken.type === 'inline' && bulletToken.content) {
              bulletLines.push(`- ${bulletToken.content}`);
            }
          }
          if (bulletLines.length > 0) {
            sectionBodyLines.push(bulletLines.join('\n'));
          }
        }
      }
    }

    // Add final section
    if (currentHeader) {
      const sectionBody = sectionBodyLines.join('\n\n');
      const preview = this.selectiveExtract(sectionBody, queryContext, MAX_PREVIEW_CHARS);
      this._addSection(summaryParts, currentHeader, currentLevel, preview ? [preview] : []);
      sectionCount++;
    }

    // Add file link footer
    summaryParts.push('');
    summaryParts.push(`**Full documentation:** [View complete file](file://${absolutePath})`);

    return {
      summary: summaryParts.join('\n'),
      sections: sectionCount,
      frontmatter
    };
  }

  /**
   * Add a section to summary parts
   * @private
   */
  _addSection(summaryParts, headerText, level, previewLines) {
    const headerMarker = '#'.repeat(level);
    summaryParts.push(`${headerMarker} ${headerText}`);
    summaryParts.push('');

    if (previewLines.length > 0) {
      // For H1, include full preview; for others add "..." if we have content
      if (level === 1) {
        summaryParts.push(previewLines.join('\n\n'));
      } else {
        // Trim preview and add ellipsis
        const preview = previewLines.join(' ').substring(0, 300);
        summaryParts.push(preview + (previewLines.join(' ').length > 300 ? '...' : ''));
      }
      summaryParts.push('');
    }
  }

  /**
   * Extract table of contents from markdown content
   * @param {string} markdownContent - Full markdown document
   * @returns {Array} Hierarchical array of headers
   */
  extractTableOfContents(markdownContent) {
    const { content } = grayMatter(markdownContent);
    const tokens = this.md.parse(content, {});

    const toc = [];
    const stack = [{ level: 0, children: toc }];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === 'heading_open') {
        const level = parseInt(token.tag.substring(1));
        const nextToken = tokens[i + 1];
        const title = nextToken && nextToken.type === 'inline' ? nextToken.content : '';

        const node = { level, title, children: [] };

        // Find appropriate parent
        while (stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        // Add to parent's children
        stack[stack.length - 1].children.push(node);

        // Push to stack for potential children
        stack.push(node);
      }
    }

    return toc;
  }
}

module.exports = { HeaderExtractor };
