/**
 * Local, deterministic detection of names that are NOT known participants (R4, audit 3.2 / 3.4 / S3).
 *
 * pseudonymize.ts replaces the names of KNOWN people (chat senders registered in the identity vault). This
 * module closes the gaps that list leaves open, without any external NER service or network call:
 *
 *  1. `createFuzzyKnownMatcher`: forms of KNOWN names that the exact matcher misses:
 *     - joined honorifics ("Ravibhai", "Priyaji", "Meenadidi"), any case, when the stem is a known name word;
 *     - nicknames written as a prefix of a known name word ("Ravi" for "Ravindra", at least 4 letters, unique);
 *     - common romanisation variants ("Preeya" for "Priya", "Sandeep"/"Sandip"), by a transliteration
 *       skeleton (aa→a, ee/ii→i, oo/uu→u, w→v, ph→f, sh→s, th→t, dh→d, bh→b, kh→k, gh→g, y→i, doubled
 *       letters collapsed), unique.
 *  2. `discoverNames`: names of people who never sent a message (mentioned only, document-only handovers).
 *     Evidence, strongest first:
 *     - an @mention ("@Kavya", "@kavya");
 *     - an honorific before ("Mr Rao", "Dr. Iyer", "Smt Lata", "shri mehta") or after ("Kavya ji",
 *       "Sharma sir", "Priya-ji", "Ravi bhai"), or joined ("Kavyaji", "Sureshbhai");
 *     - a communication / assignment cue before ("ask Kavya", "thanks Kavya", "cc Kavya", "Owner: Kavya
 *       Menon") or after ("Kavya said", "Kavya confirmed", "Kavya owns");
 *     - a preposition before ("to Kavya", "from Kavya", "with Kavya", "by Kavya"), a possessive ("Kavya's");
 *     - a capitalised word or a run of 2–3 capitalised words in the middle of a sentence;
 *     - a run of 2–3 capitalised words at the start of a sentence or line ("Kavya Menon will…");
 *     - a single capitalised word at the start of a sentence only with a following verb cue ("Kavya will").
 *     False-positive guards: a stoplist (STOP_WORDS: sentence starters, weekdays, months, common business,
 *     tech, finance and place words, brands); all-caps words (acronyms) are never names; words inside
 *     placeholders, URLs, e-mail addresses and #hashtags are skipped; and a weak candidate is rejected when
 *     the same word also appears in lower case elsewhere in the same text set (an ordinary word, not a
 *     name). Common words that are also names (COMMON_WORDS: "Will", "Asha", …) need strong evidence and
 *     are then replaced only where capitalised.
 *  3. `createNameReplacer`: replaces every occurrence of the discovered names (with their joined-honorific
 *     and possessive forms) by a given token.
 *  4. `createUnknownNamePseudonymizer`: discovery + replacement by the unnumbered `[PERSON]` token, for AI
 *     payloads that are built after parsing (human edits, Gap Interview answers, team and role titles),
 *     where no vault number can be reserved.
 *
 * Direction of error: when unsure, a capitalised word is replaced (over-pseudonymised), never sent in
 * clear. Remaining limitations: names written in lower case without an @mention or honorific ("ask
 * kavya"), names in scripts without letter case (Devanagari, Tamil, …) that are not known participants, and
 * names that are also stoplisted words.
 */

import { AMBIGUOUS_PERSON_TOKEN, COMMON_WORDS, nameWords, personToken, type KnownPerson } from "./pseudonymize";

// ── word lists ──────────────────────────────────────────────────────────────────────────────────────────

/** Titles written before a name. Lower case, without the trailing dot. */
export const HONORIFIC_PREFIXES: ReadonlySet<string> = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "shri", "sri", "shree", "smt", "shrimati", "kumari", "prof", "professor",
  "capt", "col", "maj", "lt", "gen", "sgt", "fr", "sr", "sister", "brother", "uncle", "aunty", "auntie", "madam",
  "sir", "mister", "janab", "begum", "pandit", "pt", "ustad", "thiru", "tiru", "selvi", "dear",
]);

/** Honorifics written after a name, as a separate word or with a hyphen ("Kavya ji", "Priya-ji"). */
export const HONORIFIC_SUFFIXES: ReadonlySet<string> = new Set([
  "ji", "jee", "bhai", "bhaiya", "bhayya", "bhaisaab", "sir", "madam", "maam", "ma'am", "ma’am", "mam", "sahab",
  "saab", "sahib", "saheb", "garu", "didi", "di", "da", "dada", "anna", "akka", "ben", "behen", "bhabhi", "uncle",
  "aunty", "auntie", "bhau", "tai", "mausi", "chacha",
]);

/** Honorifics that may be glued to a name ("Ravibhai", "Kavyaji"). Longest first. */
export const JOINED_SUFFIXES: readonly string[] = ["bhaiya", "bhai", "didi", "sahab", "saab", "garu", "ji"];

/** Words before a name that make it a person with high confidence. */
const CUE_BEFORE_STRONG: ReadonlySet<string> = new Set([
  "ask", "asked", "asking", "call", "called", "calling", "tell", "told", "telling", "ping", "pinged", "contact",
  "contacted", "cc", "bcc", "inform", "informed", "message", "messaged", "email", "emailed", "remind", "reminded",
  "thank", "thanks", "thx", "ty", "hi", "hello", "hey", "dm", "consult", "consulted", "notify", "notified",
  "texted", "meet", "met", "owner", "owners", "poc", "spoc", "contact", "contacts", "assignee", "assigned",
  "attendees", "responsible", "approver", "approved", "reviewer", "signatory", "coordinator", "handled",
  "handover", "manager", "lead", "incharge", "successor", "predecessor", "name", "named", "welcome", "congrats",
  "congratulations", "bye", "regards", "cheers", "sincerely", "thanking", "wrote", "per", "via",
]);

/** Prepositions and conjunctions before a name: medium confidence. */
const CUE_BEFORE_MEDIUM: ReadonlySet<string> = new Set(["to", "from", "by", "with", "and", "or", "&", "for", "of", "like"]);

/** Verbs after a name that make it a person with high confidence. */
const CUE_AFTER_STRONG: ReadonlySet<string> = new Set([
  "said", "says", "mentioned", "told", "tells", "asked", "asks", "replied", "confirmed", "confirms", "agreed",
  "agrees", "promised", "wants", "knows", "owns", "handles", "handled", "manages", "managed", "messaged",
  "emailed", "wrote", "writes", "suggested", "suggests", "paid", "pays", "signed", "joined", "resigned",
  "left", "leaves", "explained", "noted", "reported", "requested", "shared", "sent", "called", "promised",
  "approved", "approves", "decided", "decides", "insisted", "prefers", "thinks", "thought", "believes",
]);

/** Verbs after a name: weak confidence (also true of things). */
const CUE_AFTER_WEAK: ReadonlySet<string> = new Set([
  "will", "would", "can", "could", "should", "must", "may", "might", "has", "had", "is", "was", "and", "or",
  "does", "did", "needs", "needed", "got", "gets", "took", "takes", "gave", "gives", "keeps", "kept", "holds",
  "held", "collects", "collected", "brings", "brought", "runs", "ran", "leads", "led", "covers", "covered",
]);

/**
 * Capitalised words that are not names. Lower case. Sentence starters, pronouns, weekdays, months,
 * greetings, and common business, finance, tech, place and brand words seen in handover sources.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // pronouns, determiners, conjunctions, prepositions, sentence starters
  "i", "im", "ive", "id", "ill", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours", "he", "him",
  "his", "she", "her", "hers", "they", "them", "their", "theirs", "it", "its", "this", "that", "these", "those",
  "the", "a", "an", "and", "or", "but", "nor", "so", "yet", "if", "then", "else", "when", "while", "where",
  "what", "which", "who", "whom", "whose", "why", "how", "because", "since", "until", "till", "unless",
  "although", "though", "also", "too", "very", "just", "only", "even", "still", "already", "again", "never",
  "always", "often", "sometimes", "usually", "maybe", "perhaps", "please", "pls", "plz", "kindly", "ok", "okay",
  "okk", "yes", "yeah", "yep", "no", "nope", "not", "sure", "thanks", "thank", "thx", "hi", "hello", "hey",
  "dear", "regards", "cheers", "sorry", "welcome", "congrats", "good", "great", "fine", "nice", "cool", "done",
  "noted", "agreed", "right", "well", "now", "today", "tomorrow", "yesterday", "tonight", "later", "soon",
  "here", "there", "all", "any", "some", "none", "each", "every", "everyone", "everybody", "everything",
  "someone", "somebody", "something", "anyone", "anybody", "anything", "nobody", "nothing", "both", "either",
  "neither", "many", "much", "more", "most", "less", "least", "few", "several", "other", "others", "another",
  "same", "such", "own", "first", "second", "third", "last", "next", "new", "old", "main", "general", "total",
  "in", "on", "at", "to", "from", "by", "with", "without", "for", "of", "about", "above", "below", "after",
  "before", "between", "into", "onto", "over", "under", "up", "down", "out", "off", "through", "during",
  "per", "via", "as", "like", "than", "within", "across", "against", "around", "along", "among", "behind",
  "beside", "beyond", "inside", "outside", "near", "towards", "upon", "is", "are", "was", "were", "be", "been",
  "being", "am", "do", "does", "did", "done", "have", "has", "had", "will", "would", "shall", "should", "can",
  "could", "may", "might", "must", "let", "lets", "let's", "dont", "don't", "cant", "can't", "wont", "won't",
  "note", "notes", "important", "urgent", "update", "updates", "reminder", "fyi", "re", "fw", "fwd", "subject",
  "hindi", "english", "namaste", "namaskar", "jai", "hare", "om", "hmm", "haha", "lol", "wow", "oh", "ah",
  // weekdays, months, seasons, festivals
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed",
  "thu", "thur", "thurs", "fri", "sat", "sun", "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
  "sep", "sept", "oct", "nov", "dec", "spring", "summer", "autumn", "winter", "monsoon", "diwali", "deepavali",
  "holi", "eid", "christmas", "xmas", "easter", "navratri", "dussehra", "pongal", "onam", "ganesh", "ganpati",
  "durga", "puja", "rakhi", "lohri", "baisakhi", "bihu", "ramzan", "ramadan", "new", "year", "weekend", "weekday",
  "morning", "evening", "afternoon", "night", "noon", "midnight", "week", "month", "quarter", "day", "days",
  // business, finance, work
  "account", "accounts", "bank", "banking", "branch", "invoice", "invoices", "bill", "bills", "billing", "payment",
  "payments", "pay", "paid", "salary", "salaries", "payroll", "tax", "taxes", "gst", "tds", "pan", "itr", "audit",
  "auditor", "budget", "cash", "cheque", "check", "deposit", "fee", "fees", "fund", "funds", "loan", "emi",
  "expense", "expenses", "receipt", "receipts", "refund", "rent", "vendor", "vendors", "supplier", "suppliers",
  "client", "clients", "customer", "customers", "order", "orders", "purchase", "sales", "sale", "stock",
  "inventory", "delivery", "dispatch", "shipment", "shipping", "courier", "warehouse", "office", "store",
  "shop", "stall", "hall", "venue", "room", "floor", "building", "site", "plant", "factory", "project",
  "projects", "task", "tasks", "team", "teams", "group", "department", "dept", "division", "unit", "board",
  "committee", "meeting", "meetings", "call", "calls", "agenda", "minutes", "action", "actions", "item", "items",
  "plan", "plans", "planning", "schedule", "deadline", "deadlines", "status", "report", "reports", "review",
  "reviews", "approval", "approvals", "policy", "policies", "process", "processes", "procedure", "checklist",
  "handover", "handovers", "document", "documents", "doc", "docs", "file", "files", "folder", "sheet", "sheets",
  "form", "forms", "contract", "contracts", "agreement", "license", "licence", "renewal", "insurance", "claim",
  "claims", "ticket", "tickets", "issue", "issues", "risk", "risks", "decision", "decisions", "owner", "owners",
  "contact", "contacts", "access", "login", "password", "admin", "user", "users", "member", "members",
  "manager", "managers", "lead", "leads", "head", "director", "ceo", "cto", "cfo", "coo", "hr", "finance",
  "operations", "ops", "marketing", "legal", "support", "service", "services", "product", "products",
  "engineering", "tech", "it", "security", "facilities", "maintenance", "procurement", "logistics", "admin",
  "president", "secretary", "treasurer", "chairman", "chairperson", "principal", "teacher", "student",
  "students", "parent", "parents", "volunteer", "volunteers", "staff", "intern", "interns", "trainee",
  "company", "pvt", "ltd", "llp", "inc", "corp", "limited", "private", "public", "trust", "society", "club",
  "association", "foundation", "school", "college", "university", "hospital", "clinic", "temple", "church",
  "mosque", "society", "apartment", "apartments", "flat", "block", "tower", "phase", "sector", "road", "rd",
  "street", "st", "lane", "nagar", "marg", "colony", "layout", "cross", "main", "station", "airport", "market",
  "mall", "park", "garden", "city", "district", "state", "country", "north", "south", "east", "west", "central",
  "next", "steps", "step", "summary", "overview", "background", "introduction", "conclusion", "appendix",
  "section", "chapter", "page", "table", "figure", "total", "subtotal", "amount", "balance", "rate", "price",
  "cost", "costs", "quote", "quotation", "estimate", "target", "targets", "goal", "goals", "result", "results",
  "phone", "mobile", "email", "mail", "address", "number", "id", "code", "otp", "pin", "upi", "ifsc", "neft",
  "rtgs", "imps", "wifi", "wi-fi", "internet", "server", "database", "backup", "laptop", "computer", "printer",
  "projector", "camera", "keys", "key", "lock", "locker", "gate", "door", "car", "bike", "van", "bus", "truck",
  "parking", "security", "guard", "cleaning", "electricity", "water", "generator", "ac", "repair", "repairs",
  "new", "pending", "open", "closed", "complete", "completed", "draft", "final", "confirmed", "cancelled",
  "approved", "rejected", "paid", "unpaid", "due", "overdue", "active", "inactive", "yes", "no", "na", "tbd",
  "question", "questions", "answer", "answers", "problem", "problems", "solution", "help", "info", "details",
  "detail", "list", "lists", "data", "number", "numbers", "version", "copy", "link", "links", "photo", "photos",
  "video", "videos", "image", "images", "attachment", "attachments", "media", "omitted", "message", "messages",
  "deleted", "edited", "chat", "chats", "thread", "channel", "channels", "post", "posts", "comment", "comments",
  // tech, apps, brands
  "excel", "word", "powerpoint", "outlook", "teams", "office", "windows", "microsoft", "google", "gmail", "drive",
  "docs", "sheets", "slides", "calendar", "meet", "zoom", "skype", "slack", "discord", "telegram", "whatsapp",
  "signal", "github", "gitlab", "jira", "confluence", "notion", "trello", "asana", "figma", "canva", "dropbox",
  "onedrive", "sharepoint", "salesforce", "hubspot", "zoho", "tally", "busy", "quickbooks", "xero", "sap",
  "oracle", "aws", "azure", "gcp", "vercel", "supabase", "linux", "android", "iphone", "ipad", "mac", "macbook",
  "apple", "samsung", "airtel", "jio", "vodafone", "vi", "bsnl", "paytm", "phonepe", "gpay", "razorpay",
  "amazon", "flipkart", "swiggy", "zomato", "uber", "ola", "rapido", "dunzo", "blinkit", "zepto", "bigbasket",
  "myntra", "meesho", "nykaa", "facebook", "instagram", "twitter", "linkedin", "youtube", "chrome", "firefox",
  "safari", "pdf", "csv", "xlsx", "docx", "ppt", "pptx", "json", "api", "app", "apps", "website", "web", "portal",
  "dashboard", "baton", "omega", "claude", "openai", "chatgpt", "gemini", "copilot",
  // banks, government, India places
  "sbi", "hdfc", "icici", "axis", "kotak", "yes", "pnb", "canara", "baroda", "union", "indusind", "idfc", "rbi",
  "sebi", "nse", "bse", "lic", "epfo", "esic", "uidai", "aadhaar", "aadhar", "india", "indian", "bharat",
  "mumbai", "bombay", "delhi", "new", "bangalore", "bengaluru", "chennai", "madras", "kolkata", "calcutta",
  "pune", "hyderabad", "ahmedabad", "surat", "jaipur", "lucknow", "kanpur", "nagpur", "indore", "bhopal",
  "patna", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad", "thane", "navi", "nashik", "goa",
  "kochi", "cochin", "trivandrum", "thiruvananthapuram", "coimbatore", "madurai", "mysore", "mysuru",
  "mangalore", "visakhapatnam", "vizag", "vijayawada", "chandigarh", "ludhiana", "amritsar", "dehradun",
  "shimla", "srinagar", "jammu", "guwahati", "bhubaneswar", "ranchi", "raipur", "varanasi", "agra", "allahabad",
  "prayagraj", "kerala", "karnataka", "maharashtra", "gujarat", "rajasthan", "punjab", "haryana", "bihar",
  "odisha", "orissa", "assam", "bengal", "tamil", "nadu", "telangana", "andhra", "pradesh", "uttar", "madhya",
  "himachal", "uttarakhand", "jharkhand", "chhattisgarh", "andheri", "bandra", "powai", "koramangala",
  "indiranagar", "whitefield", "electronic", "dwarka", "saket", "rohini", "london", "dubai", "singapore", "usa",
  "us", "uk", "america", "american", "europe", "asia", "africa", "australia", "canada", "china", "japan",
  "germany", "france", "nepal", "sri", "lanka", "bangladesh", "pakistan", "english", "hindi", "marathi",
  "gujarati", "tamil", "telugu", "kannada", "malayalam", "bengali", "punjabi", "urdu", "god", "lord", "bhagwan",
]);

/** Markers that make a lower-case word a name ("mr rao", "kavya ji", "sharma sir"). */
const LOWER_PREFIX_MARKERS: ReadonlySet<string> = new Set(["mr", "mrs", "ms", "dr", "shri", "sri", "smt", "prof"]);
const LOWER_SUFFIX_MARKERS: ReadonlySet<string> = new Set(["ji", "jee", "bhai", "bhaiya", "sir", "madam", "maam", "sahab", "saab", "garu", "didi"]);
/** Hindi / Hinglish words often followed by "ji" or "sir" that are not names. */
const NOT_NAMES_LOWER: ReadonlySet<string> = new Set([
  "chalo", "chaliye", "theek", "thik", "haan", "han", "nahi", "nahin", "ok", "okay", "acha", "accha", "achha", "ji",
  "bilkul", "zaroor", "jarur", "shukriya", "dhanyavad", "dhanyawad", "namaste", "namaskar", "pranam", "sorry",
  "thanks", "thank", "please", "yes", "done", "noted", "sure", "right", "good", "morning", "evening", "night",
  "aap", "aapka", "aapko", "hum", "humne", "mera", "meri", "kab", "kya", "kaise", "batao", "bataiye", "dekho",
  "dekhiye", "suniye", "suno", "boliye", "bolo", "karo", "kariye", "bhejo", "bhejiye", "hello", "hi", "hey",
]);

/** Words that look like a name + joined suffix but are not ("Emoji", "Fiji"). Lower case. */
const NOT_JOINED: ReadonlySet<string> = new Set(["emoji", "emojis", "fiji", "kanji", "hiji", "shiji", "wasabi", "bhaji", "pav", "puri", "garuda"]);

// ── tokenisation ────────────────────────────────────────────────────────────────────────────────────────

const TOKEN = /[\p{L}\p{M}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}]+)*/gu;
const TITLE = /^(?:\p{Lu}['’])?\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)?$/u;
const LOWER = /^[\p{Ll}\p{M}]+$/u;
const POSSESSIVE = /['’]s$/iu;
const SENTENCE_BREAK = /[.!?\n;:•▪·|]/;
/** The rest of a placeholder after its "[": "PERSON_1]", "EXCLUDED_PARTICIPANT]". */
const PLACEHOLDER_REST = /^[A-Z][A-Z0-9_]*\]/;
/** Only spaces and tabs (including no-break spaces), no line break. */
const SPACES_ONLY = /^[^\S\r\n]+$/;
/** Characters that mean the word belongs to a placeholder, URL, address, handle or code. */
const GLUED_BEFORE = /[[\]_#/\\.@=+*\p{N}<>~`$%^]/u;
const GLUED_AFTER = /^(?:[.@][\p{L}\p{N}]|[\]_/\\=<>`$%^]|\p{N})/u;

interface Tok {
  start: number;
  end: number;
  raw: string;
  /** Possessive "'s" removed. */
  stem: string;
  lower: string;
  possessive: boolean;
  title: boolean;
  lowerCase: boolean;
  /** Part of a placeholder, URL, e-mail address, hashtag or code: never a name. */
  glued: boolean;
  /** Preceded by "@" (an explicit mention). */
  mention: boolean;
  /** First word of a sentence, line or clause after ":". */
  sentenceStart: boolean;
  /** The text between the previous token and this one. */
  sepBefore: string;
}

function letters(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

/** "Dr. Rao": the dot after an honorific is not a sentence end. */
function effectiveSep(prev: Tok | undefined, sep: string): string {
  return prev && HONORIFIC_PREFIXES.has(prev.lower) && /^\.\s*$/.test(sep) ? " " : sep;
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let prevEnd = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const end = start + raw.length;
    // Placeholders ([PERSON_1], [PHONE_2], [EXCLUDED_PARTICIPANT]) are not words: the word after one is
    // judged by the word before it ("Thanks [PERSON_1] Menon").
    if (text[start - 1] === "[" && PLACEHOLDER_REST.test(text.slice(start, start + 40))) continue;
    const possessive = POSSESSIVE.test(raw) && raw.length > 3;
    const stem = possessive ? raw.slice(0, -2) : raw;
    const before = text.slice(Math.max(0, start - 1), start);
    const before2 = text.slice(Math.max(0, start - 3), start);
    const after = text.slice(end, end + 2);
    const sepBefore = text.slice(prevEnd, start);
    // "@kavya" is a mention; "name@example.org" is an e-mail address (a letter or digit before the "@").
    const atIndex = text.lastIndexOf("@", start - 1);
    const handle = atIndex >= 0 && start - atIndex <= 3 && !/[\p{L}\p{N}_.]/u.test(text[atIndex - 1] ?? " ");
    const mention = handle && (MENTION_BEFORE.test(before2) || before === "@") && !/^\.[\p{L}]/u.test(after);
    const glued = !mention && ((before !== "" && GLUED_BEFORE.test(before)) || GLUED_AFTER.test(after));
    out.push({
      start,
      end,
      raw,
      stem,
      lower: stem.toLocaleLowerCase("und"),
      possessive,
      title: TITLE.test(stem),
      lowerCase: LOWER.test(stem),
      glued,
      mention,
      sentenceStart: out.length === 0 ? true : SENTENCE_BREAK.test(effectiveSep(out[out.length - 1], sepBefore)),
      sepBefore,
    });
    prevEnd = end;
  }
  return out;
}

/** The token before `i` in the same clause (separated only by spaces, commas, hyphens, quotes, brackets or ":"). */
function prevWord(toks: Tok[], i: number): Tok | null {
  if (i === 0) return null;
  if (/[.!?\n;•|]/.test(effectiveSep(toks[i - 1], toks[i].sepBefore))) return null;
  return toks[i - 1];
}

function nextWord(toks: Tok[], i: number): Tok | null {
  if (i + 1 >= toks.length) return null;
  const sep = toks[i + 1].sepBefore;
  if (!/^[\s,-]*$/.test(sep) || /\n/.test(sep)) return null;
  return toks[i + 1];
}

function isStop(lower: string): boolean {
  return STOP_WORDS.has(lower) || HONORIFIC_PREFIXES.has(lower) || HONORIFIC_SUFFIXES.has(lower) || CUE_BEFORE_STRONG.has(lower);
}

function joinedSplit(tok: Tok): { stem: string; suffix: string } | null {
  if (tok.glued || NOT_JOINED.has(tok.lower)) return null;
  for (const suffix of JOINED_SUFFIXES) {
    if (tok.lower.length <= suffix.length + 2 || !tok.lower.endsWith(suffix)) continue;
    const stem = tok.stem.slice(0, tok.stem.length - suffix.length);
    if (letters(stem) < 3) continue;
    return { stem, suffix: tok.stem.slice(tok.stem.length - suffix.length) };
  }
  return null;
}

// ── transliteration skeleton and fuzzy known names ──────────────────────────────────────────────────────

/** A romanisation-insensitive skeleton of one name word (see the module comment). */
export function translitSkeleton(word: string): string {
  let s = word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  s = s
    .replace(/aa/g, "a")
    .replace(/ee|ii|ie|ey/g, "i")
    .replace(/oo|uu|ou/g, "u")
    .replace(/ph/g, "f")
    .replace(/sh/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/ck|q/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1")
    .replace(/h$/, "");
  return s;
}

const SEP = "[\\s\\u00A0\\u202F._-]+";
const NOT_BEFORE = "(?<![\\p{L}\\p{N}\\p{M}_\\[@#/.])";
const NOT_AFTER = "(?![\\p{L}\\p{N}\\p{M}_\\]])";
const JOINED_ALT = JOINED_SUFFIXES.join("|");
/** Bidi isolates and marks WhatsApp wraps around mentions (U+2066..U+2069, U+200E, U+200F). */
const ISOLATES = `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}${String.fromCharCode(0x200e)}${String.fromCharCode(0x200f)}]`;
const MENTION_BEFORE = new RegExp(`@${ISOLATES}*~?$`, "u");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface TextTransform {
  /** True when the transform never changes anything. */
  readonly isEmpty: boolean;
  apply(text: string): { text: string; count: number };
}

const IDENTITY_TRANSFORM: TextTransform = { isEmpty: true, apply: (text) => ({ text, count: 0 }) };

/**
 * Joined honorifics, nickname prefixes and transliteration variants of KNOWN people (run after the exact
 * matcher of pseudonymize.ts). A form that fits two people becomes `[PERSON]`.
 */
export function createFuzzyKnownMatcher(people: readonly KnownPerson[]): TextTransform {
  const byWord = new Map<string, Set<number>>();
  for (const p of people) {
    if (p.label === null) continue;
    for (const w of nameWords(p.label)) {
      const lw = w.toLocaleLowerCase("und");
      if (letters(w) < 3 || COMMON_WORDS.has(lw) || STOP_WORDS.has(lw)) continue;
      const set = byWord.get(lw) ?? new Set<number>();
      set.add(p.ordinal);
      byWord.set(lw, set);
    }
  }
  if (byWord.size === 0) return IDENTITY_TRANSFORM;
  const skeletons = new Map<string, Set<number>>();
  for (const [w, ords] of byWord) {
    const sk = translitSkeleton(w);
    if (sk.length < 3) continue;
    const set = skeletons.get(sk) ?? new Set<number>();
    for (const o of ords) set.add(o);
    skeletons.set(sk, set);
  }
  const tokenOf = (ords: Set<number>) => (ords.size === 1 ? personToken([...ords][0]) : AMBIGUOUS_PERSON_TOKEN);
  const lookup = (word: string, allowFuzzy: boolean): Set<number> | null => {
    const lw = word.toLocaleLowerCase("und");
    const exact = byWord.get(lw);
    if (exact) return exact;
    if (!allowFuzzy) return null;
    const sk = translitSkeleton(lw);
    if (sk.length >= 3 && skeletons.has(sk)) return skeletons.get(sk)!;
    // Nickname = a prefix of at least 4 letters ending in a vowel ("Ravi" for "Ravindra", "Mani" for
    // "Manish"); "Sand" is not "Sandeep".
    if (letters(lw) >= 4 && /[aeiouy]$/.test(lw)) {
      const hits = new Set<number>();
      let words = 0;
      for (const [w, ords] of byWord) {
        if (w.length >= lw.length + 2 && w.startsWith(lw)) {
          words += 1;
          for (const o of ords) hits.add(o);
        }
      }
      if (words >= 1) return hits;
    }
    return null;
  };

  return {
    isEmpty: false,
    apply(text: string) {
      const toks = tokenize(text);
      if (toks.length === 0) return { text, count: 0 };
      let out = "";
      let last = 0;
      let count = 0;
      for (const t of toks) {
        if (t.glued) continue;
        let replacement: string | null = null;
        const j = joinedSplit(t);
        if (j) {
          const ords = lookup(j.stem, /^\p{Lu}/u.test(j.stem));
          if (ords) replacement = `${tokenOf(ords)}-${j.suffix}`;
        }
        if (replacement === null && t.title && !isStop(t.lower) && !COMMON_WORDS.has(t.lower) && letters(t.stem) >= 4) {
          const ords = lookup(t.stem, true);
          if (ords) replacement = tokenOf(ords) + (t.possessive ? t.raw.slice(-2) : "");
        }
        if (replacement === null) continue;
        out += text.slice(last, t.start) + replacement;
        last = t.end;
        count += 1;
      }
      return count === 0 ? { text, count } : { text: out + text.slice(last), count };
    },
  };
}

// ── discovery ───────────────────────────────────────────────────────────────────────────────────────────

export interface DiscoveredName {
  /** The name as first written (possessive and joined honorific removed), e.g. "Kavya Menon". */
  label: string;
  /** Replace only capitalised occurrences (the name is also a common word, or appears in lower case). */
  caseSensitive: boolean;
}

type Strength = 0 | 1 | 2 | 3; // none, weak, medium, strong

const MAX_RUN = 3;

/** Lower-case words used as ordinary words (not right after a cue or honorific) somewhere in `texts`. */
function ordinaryLowerWords(all: Tok[][]): Set<string> {
  const seen = new Set<string>();
  for (const toks of all) {
    toks.forEach((t, i) => {
      if (!t.lowerCase || t.glued || t.mention) return;
      const p = prevWord(toks, i);
      if (p && (HONORIFIC_PREFIXES.has(p.lower) || CUE_BEFORE_STRONG.has(p.lower))) return;
      const n = nextWord(toks, i);
      if (n && HONORIFIC_SUFFIXES.has(n.lower)) return;
      seen.add(t.lower);
    });
  }
  return seen;
}

/**
 * Names of people in `texts` that are not already placeholders. Deterministic; the same input gives the
 * same output in the same order (first occurrence).
 */
export function discoverNames(texts: readonly string[]): DiscoveredName[] {
  const all = texts.map((t) => tokenize(t.normalize("NFC")));
  const ordinary = ordinaryLowerWords(all);
  const found = new Map<string, DiscoveredName>();
  const add = (words: string[], strength: Strength) => {
    const key = words.map((w) => w.toLocaleLowerCase("und")).join(" ");
    const single = words.length === 1;
    const lowerSeen = words.some((w) => ordinary.has(w.toLocaleLowerCase("und")));
    const common = single && COMMON_WORDS.has(key);
    // A common word that is also a name ("Kiran", "Mark") needs a cue or a possessive; any lower-case use
    // elsewhere needs strong evidence.
    if ((strength < 3 && lowerSeen) || (strength < 2 && common)) return;
    if (letters(words.join("")) < 3) return;
    const caseSensitive = lowerSeen || common || words.some((w) => COMMON_WORDS.has(w.toLocaleLowerCase("und")));
    const prev = found.get(key);
    if (prev) {
      if (caseSensitive && !prev.caseSensitive) prev.caseSensitive = true;
      return;
    }
    found.set(key, { label: words.join(" "), caseSensitive });
  };

  for (const toks of all) {
    // Joined honorifics: "Kavyaji", "Sureshbhai" (capitalised stem). Kept whole: "Balaji" or "Shivaji" is a
    // name in itself, so it is never split into a shorter name.
    for (const t of toks) {
      const j = joinedSplit(t);
      if (j && /^\p{Lu}/u.test(j.stem) && !isStop(j.stem.toLocaleLowerCase("und"))) add([t.stem], 3);
    }
    // Lower-case names with an explicit marker: "@kavya", "mr rao", "kavya ji".
    toks.forEach((t, i) => {
      if (t.glued || t.title || !t.lowerCase || isStop(t.lower) || letters(t.stem) < 3) return;
      const p = prevWord(toks, i);
      const n = nextWord(toks, i);
      // Without capitals, only unambiguous markers count, and never for a word also used ordinarily
      // ("chalo ji", "haan ji" are not names).
      const marked = (p && LOWER_PREFIX_MARKERS.has(p.lower)) || (n && LOWER_SUFFIX_MARKERS.has(n.lower));
      if (t.mention || (marked && !ordinary.has(t.lower) && !COMMON_WORDS.has(t.lower) && !NOT_NAMES_LOWER.has(t.lower))) {
        add([t.stem], 3);
      }
    });
    // Capitalised runs.
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      const usable = (x: Tok) => !x.glued && x.title && !isStop(x.lower);
      if (!usable(t) && !(t.mention && !t.glued && /^\p{Lu}/u.test(t.stem) && !isStop(t.lower))) {
        i += 1;
        continue;
      }
      const run: Tok[] = [t];
      while (
        run.length < MAX_RUN + 1 &&
        i + run.length < toks.length &&
        !run[run.length - 1].possessive &&
        SPACES_ONLY.test(toks[i + run.length].sepBefore) &&
        usable(toks[i + run.length])
      ) {
        run.push(toks[i + run.length]);
      }
      i += run.length;
      if (run.length > MAX_RUN) continue; // a title or heading, not a name
      const first = run[0];
      const lastTok = run[run.length - 1];
      const p = prevWord(toks, i - run.length);
      const n = nextWord(toks, i - 1);
      let strength: Strength = 0;
      if (first.mention) strength = 3;
      else if (p && HONORIFIC_PREFIXES.has(p.lower)) strength = 3;
      else if (n && HONORIFIC_SUFFIXES.has(n.lower) && !lastTok.possessive) strength = 3;
      else if (p && CUE_BEFORE_STRONG.has(p.lower)) strength = 3;
      else if (n && CUE_AFTER_STRONG.has(n.lower) && !lastTok.possessive) strength = 3;
      else if ((p && CUE_BEFORE_MEDIUM.has(p.lower) && !first.sentenceStart) || lastTok.possessive) strength = 2;
      else if (!first.sentenceStart) strength = 1;
      else if (run.length >= 2) strength = 1;
      else if (n && CUE_AFTER_WEAK.has(n.lower)) strength = 1;
      if (strength === 1) {
        // Part of a capitalised phrase with an ordinary capitalised word ("Stall Rotation Plan", "Google
        // Drive"): a title or a product, not a person.
        const before = i - run.length > 0 ? toks[i - run.length - 1] : null;
        const after = i < toks.length ? toks[i] : null;
        const phraseWord = (x: Tok | null, sep: string) => x !== null && SPACES_ONLY.test(sep) && x.title && STOP_WORDS.has(x.lower) && !CUE_BEFORE_STRONG.has(x.lower);
        if (phraseWord(before, first.sepBefore) || phraseWord(after, after?.sepBefore ?? "")) continue;
      }
      if (strength === 0) continue;
      add(run.map((x) => x.stem), strength);
    }
  }
  return [...found.values()];
}

// ── replacement ─────────────────────────────────────────────────────────────────────────────────────────

/** Replaces every occurrence of each name (and its joined-honorific form) with its token. */
export function createNameReplacer(entries: ReadonlyArray<{ label: string; token: string; caseSensitive: boolean }>): TextTransform {
  const forms = new Map<string, { token: string; caseSensitive: boolean; words: string[] }>();
  for (const e of entries) {
    const words = e.label.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const key = words.map((w) => w.toLocaleLowerCase("und")).join(" ");
    if (!forms.has(key)) forms.set(key, { token: e.token, caseSensitive: e.caseSensitive, words });
  }
  if (forms.size === 0) return IDENTITY_TRANSFORM;
  const ordered = [...forms.values()].sort((a, b) => b.words.length - a.words.length || b.words.join("").length - a.words.join("").length);
  const alt = ordered.map((f) => f.words.map(escapeRegExp).join(SEP)).join("|");
  const re = new RegExp(`${NOT_BEFORE}(?:@${ISOLATES}*~?)?(${alt})(?:-?(${JOINED_ALT}))?${NOT_AFTER}`, "giu");
  return {
    isEmpty: false,
    apply(text: string) {
      let count = 0;
      const out = text.normalize("NFC").replace(re, (whole: string, name: string, suffix: string | undefined) => {
        const words = name.split(new RegExp(SEP, "u"));
        const form = forms.get(words.map((w) => w.toLocaleLowerCase("und")).join(" "));
        if (!form) return whole;
        if (form.caseSensitive && !words.every((w, k) => w === form.words[k] || TITLE.test(w))) return whole;
        count += 1;
        return suffix ? `${form.token}-${suffix}` : form.token;
      });
      return count === 0 ? { text, count } : { text: out, count };
    },
  };
}

/** Chains transforms left to right. */
export function chainTransforms(...transforms: TextTransform[]): TextTransform {
  const live = transforms.filter((t) => !t.isEmpty);
  if (live.length === 0) return IDENTITY_TRANSFORM;
  return {
    isEmpty: false,
    apply(text: string) {
      let count = 0;
      let cur = text;
      for (const t of live) {
        const r = t.apply(cur);
        cur = r.text;
        count += r.count;
      }
      return { text: cur, count };
    },
  };
}

/**
 * For AI payloads built after parsing: discovers names across all of `texts` (so a name is replaced the
 * same way in the claim and in the quote) and replaces each with the unnumbered `[PERSON]` token.
 */
export function createUnknownNamePseudonymizer(texts: readonly string[]): TextTransform {
  const names = discoverNames(texts);
  return createNameReplacer(names.map((n) => ({ ...n, token: AMBIGUOUS_PERSON_TOKEN })));
}
