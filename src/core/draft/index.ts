export { parseFrontMatter, normalizeNewlines, type FrontMatterEntry, type FrontMatterResult } from './frontmatter';
export {
  BANNER,
  FRONT_MATTER_KEYS,
  SOURCES_FIELD,
  TEMPLATE_CHANNELS,
  parseTemplate,
  type FieldRef,
  type ParsedTemplate,
  type TemplateParseResult,
} from './template';
export {
  CONTEXT_FIELDS,
  addBusinessDays,
  addCalendarDays,
  buildDraftContext,
  describeLookup,
  formatRights,
  isSourcedValue,
  ursEligibility,
  type DraftContext,
  type Sourced,
} from './context';
export { ensureBanner, lookupPath, renderTemplate, type FieldStatus, type RenderResult } from './merge';
export { base64, buildEml, encodeHeader, parseAddress, quotedPrintable, rfc5322Date, sanitizeHeaderValue, type EmlAttachment, type EmlMessage, type ParsedAddress } from './eml';
export { MAILTO_MAX, buildMailto } from './mailto';
export { MAX_TEMPLATE_BYTES, builtinTemplates, resolveTemplates, validateImportedTemplate } from './registry';
