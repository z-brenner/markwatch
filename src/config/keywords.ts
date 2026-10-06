// Words combined with each seed by the dictionary technique ("acme-login",
// "secureacme"…). Written for Markwatch; editable per case.
export const DEFAULT_DICTIONARY: string[] = [
  'login', 'signin', 'secure', 'account', 'accounts', 'verify', 'verification',
  'support', 'help', 'helpdesk', 'service', 'pay', 'payment', 'billing', 'invoice',
  'wallet', 'app', 'portal', 'online', 'web', 'mail', 'auth', 'sso', 'update',
  'security', 'official', 'store', 'shop', 'team', 'hr', 'careers', 'jobs', 'admin',
  'my', 'id', 'cloud', 'connect', 'customer', 'client', 'recovery',
];

// Keywords that signal credential or payment phishing when they appear in a
// candidate domain. Used by scoring; a subset of DEFAULT_DICTIONARY.
export const RISKY_KEYWORDS: string[] = [
  'login', 'signin', 'secure', 'account', 'verify', 'verification', 'pay', 'payment',
  'billing', 'invoice', 'wallet', 'auth', 'sso', 'update', 'security', 'recovery',
  'support', 'helpdesk',
];
