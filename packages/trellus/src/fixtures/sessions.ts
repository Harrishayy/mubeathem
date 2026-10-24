/**
 * Six realistic Corgi cold calls (startup insurance: D&O, E&O, cyber, AI liability, EPLI) plus two
 * sessions the recommended filters should exclude. Records are keyed by documented snake_case
 * column paths with the values session-list-v6 would return: enum names, unset values as
 * ''/0/false/[], `started_at` in seconds, JSON-text custom fields.
 */
export type SessionRecord = Record<string, unknown>;

const sec = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** [isCustomer, text, seconds] lines; consecutive turns are separated by a short gap. */
type Line = [boolean, string, number];
function script(lines: Line[], firstAt: number): Pick<SessionRecord, 'turn_data.texts' | 'turn_data.is_customers' | 'turn_data.starts' | 'turn_data.ends'> {
  const texts: string[] = [];
  const who: boolean[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = firstAt;
  for (const [isCustomer, text, dur] of lines) {
    texts.push(text);
    who.push(isCustomer);
    starts.push(Math.round(t * 100) / 100);
    ends.push(Math.round((t + dur) * 100) / 100);
    t += dur + 0.6;
  }
  return { 'turn_data.texts': texts, 'turn_data.is_customers': who, 'turn_data.starts': starts, 'turn_data.ends': ends };
}

/** Every column the fixtures carry, at its proto default. */
export const SESSION_DEFAULTS: SessionRecord = {
  session_id: '',
  team_id: 'tm_corgi_outbound',
  started_at: 0,
  conversation_type: 'CONVERSATION_TYPE_CALL',
  customer_address: '',
  agent_address: '+14155550100',
  address_type: 'ADDRESS_TYPE_PHONE',
  resource_id: '',
  is_provisional: false,
  customer_joined: true,
  agent_joined: true,
  duration: 0,
  customer_words: 0,
  agent_words: 0,
  end_reason: 'END_REASON_CUSTOMER_LEFT',
  platform: 'PLATFORM_HUBSPOT',
  'customer_data.name': '',
  'customer_data.title': '',
  'customer_data.company_name': '',
  'customer_data.company_url': '',
  'customer_data.company_industry': [],
  'customer_data.custom_fields': '',
  'dial_metric.is_connected': true,
  'dial_metric.is_dial': true,
  'dial_metric.is_live': true,
  'dial_metric.live_duration': 0,
  'dial_metric.has_voicemail': false,
  'dial_metric.left_voicemail': false,
  'dial_metric.is_inbound': false,
  'dial_metric.parallel_lines': 3,
  'dial_metric.sip_code': 200,
  'sales_metric.has_prospect': false,
  'sales_metric.has_gatekeeper': false,
  'sales_metric.has_obj_using_competitors': false,
  'sales_metric.has_obj_not_relevant': false,
  'sales_metric.has_offer_meeting': false,
  'sales_metric.has_offer_email': false,
  'sales_metric.has_meeting_confirm': false,
  'sales_metric.has_product_interest': false,
  'user_log.disposition': '',
  'user_log.sentiment': '',
  'user_log.purpose': '',
  'user_log.notes': '',
  'user_log.retry_at': 0,
  'user_log.source': 0,
  'turn_data.texts': [],
  'turn_data.is_customers': [],
  'turn_data.starts': [],
  'turn_data.ends': [],
};

const session = (r: SessionRecord): SessionRecord => ({ ...SESSION_DEFAULTS, ...r });

export const FIXTURE_IDS = {
  booked: 'c0a8f2e4-5b1d-4c7e-9f3a-21d6b8e04a11',
  broker: '7e19d3b2-0c4f-4a8e-b6d1-93f2a5c7e822',
  gatekeeper: '4b6e0a91-d2c3-4f5b-8e7a-0c1d9f3b6a33',
  voicemail: 'f2d47c10-9a8b-4e3f-a5c6-7b0e1d2c3f44',
  emailBrushOff: '9c3b1e7a-4d6f-4a2b-8c9e-5f0a1b2d3e55',
  notInterested: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c66',
  noAnswer: '5d6e7f80-1a2b-4c3d-9e4f-6a7b8c9d0e77',
  messaging: '8e9f0a1b-2c3d-4e5f-a6b7-c8d9e0f1a288',
} as const;

const booked = session({
  session_id: FIXTURE_IDS.booked,
  started_at: sec('2026-10-20T16:02:11Z'),
  customer_address: '+1 (415) 555-0142',
  resource_id: 'usr_7f3a1c',
  duration: 238.4,
  customer_words: 96,
  agent_words: 171,
  'customer_data.name': 'Priya Raman',
  'customer_data.title': 'Co-founder & CEO',
  'customer_data.company_name': 'Lumenfold AI',
  'customer_data.company_url': 'https://lumenfold.example',
  'customer_data.company_industry': ['Software', 'Artificial Intelligence'],
  'customer_data.custom_fields': JSON.stringify({ hubspot_contact_id: '90210441', email: 'priya@lumenfold.example', funding_stage: 'Series A', headcount: '22' }),
  'dial_metric.live_duration': 214.2,
  'sales_metric.has_prospect': true,
  'sales_metric.has_offer_meeting': true,
  'sales_metric.has_meeting_confirm': true,
  'sales_metric.has_product_interest': true,
  'user_log.disposition': 'Meeting Booked',
  'user_log.sentiment': 'Positive',
  'user_log.purpose': 'Cold call',
  'user_log.notes': 'Lead investor asked for D&O. AI scheduling product, ~40 customers. Thu 2pm with underwriter.',
  ...script(
    [
      [false, "Hi Priya, it's Jordan from Corgi. I know I'm calling out of the blue, have you got thirty seconds?", 5.1],
      [true, "Uh, sure, thirty seconds. What's this about?", 2.4],
      [false, 'We insure venture-backed startups. Most founders we speak to after a Series A find their investors want D&O in place before the next board meeting. Is that on your list yet?', 9.8],
      [true, "Actually, yeah. Our lead investor mentioned it last week. We haven't done anything about it.", 4.6],
      [false, "That's really common. Can I ask, are you shipping anything with models in production? That changes what you need.", 5.9],
      [true, "We are. We've got an AI scheduling product with about forty customers.", 3.7],
      [false, "Then you'd want E&O that actually covers AI output, which a lot of standard policies exclude. We can quote D&O and AI liability together in a day.", 8.2],
      [true, 'How much does that usually run for a company our size?', 2.9],
      [false, "For a twenty-person Series A it's usually a few thousand a year, but I'd rather give you a real number than a guess. Could we do twenty minutes Thursday with our underwriter?", 9.4],
      [true, 'Thursday afternoon works. Two o\'clock?', 2.2],
      [false, "Two o'clock Thursday. I'll send the invite to priya at lumenfold, is that right?", 4.1],
      [true, "That's right. Thanks Jordan.", 1.6],
    ],
    24.2,
  ),
});

const broker = session({
  session_id: FIXTURE_IDS.broker,
  started_at: sec('2026-10-20T17:15:40Z'),
  customer_address: '415.555.0199',
  resource_id: 'usr_2b9d4e',
  duration: 131.9,
  customer_words: 41,
  agent_words: 98,
  'customer_data.name': 'Marcus Feld',
  'customer_data.title': 'CFO',
  'customer_data.company_name': 'Tessellate Health, Inc.',
  'customer_data.company_url': 'https://tessellate.example',
  'customer_data.company_industry': ['Healthcare', 'Software'],
  'customer_data.custom_fields': JSON.stringify({ hubspot_contact_id: '90210582', funding_stage: 'Series B' }),
  'dial_metric.live_duration': 104.6,
  'sales_metric.has_prospect': true,
  'sales_metric.has_obj_using_competitors': true,
  'sales_metric.has_offer_email': true,
  'user_log.disposition': 'Interested - Follow Up',
  'user_log.sentiment': 'Neutral',
  'user_log.purpose': 'Cold call',
  'user_log.notes': 'Has a broker. Unsure if cyber covers HIPAA fines. Send comparison, call Tue.',
  'user_log.retry_at': sec('2026-10-27T17:00:00Z'),
  ...script(
    [
      [false, 'Hi Marcus, Sam from Corgi. We insure startups like Tessellate. Have I caught you at a bad time?', 4.8],
      [true, 'Kind of in between things. What is it?', 2.1],
      [false, 'Quick one: when did you last review your cyber cover? Health data companies are seeing underwriters tighten up this year.', 6.3],
      [true, 'We have a broker for all that. They handle it.', 2.6],
      [false, "Makes sense, most of our clients had one too. Out of curiosity, does your broker's cyber policy cover regulatory fines after a HIPAA breach?", 7.0],
      [true, "I honestly don't know. I'd have to check.", 2.3],
      [false, "That's the gap we see most. Would it help if I sent a one-page comparison you could hold up against your current policy?", 6.1],
      [true, "Sure, send it over. If it's actually different I'll take a look.", 3.2],
      [false, "Will do. I'll follow up next Tuesday to see if anything jumped out.", 3.4],
      [true, 'Fine, Tuesday.', 1.0],
    ],
    21.3,
  ),
});

const gatekeeper = session({
  session_id: FIXTURE_IDS.gatekeeper,
  started_at: sec('2026-10-21T15:40:05Z'),
  customer_address: '+14155550123',
  resource_id: 'usr_7f3a1c',
  duration: 88.0,
  customer_words: 52,
  agent_words: 61,
  'customer_data.name': 'Dana Whitfield',
  'customer_data.title': 'CEO',
  'customer_data.company_name': 'Northwind Robotics',
  'customer_data.company_url': 'https://northwind-robotics.example',
  'customer_data.custom_fields': JSON.stringify({ hubspot_contact_id: '90210733' }),
  'dial_metric.live_duration': 61.5,
  'sales_metric.has_gatekeeper': true,
  'user_log.disposition': 'Gatekeeper - Blocked',
  'user_log.sentiment': 'Neutral',
  'user_log.purpose': 'Cold call',
  'user_log.notes': 'Front desk (Kelly). No transfer, would not name finance lead.',
  ...script(
    [
      [true, 'Northwind Robotics, this is Kelly.', 1.9],
      [false, "Hi Kelly, it's Jordan calling for Dana Whitfield, is she around?", 3.2],
      [true, 'Can I ask what this is regarding?', 1.8],
      [false, "Of course, it's about insurance ahead of the company's next funding round. Dana will know the context.", 5.0],
      [true, 'Is she expecting your call?', 1.4],
      [false, 'Not today specifically. Is there a better time to catch her?', 3.0],
      [true, "She doesn't take sales calls. You can email info at northwind and it'll get passed on.", 4.3],
      [false, 'Understood. Who usually looks after insurance there, is it Dana or your finance lead?', 4.1],
      [true, "I really can't share that. Sorry, I've got another line.", 2.7],
    ],
    19.8,
  ),
});

const voicemail = session({
  session_id: FIXTURE_IDS.voicemail,
  started_at: sec('2026-10-21T16:05:52Z'),
  customer_address: '(646) 555-0177',
  resource_id: 'usr_2b9d4e',
  duration: 47.3,
  'customer_data.name': 'Elena Sorokin',
  'customer_data.title': 'CTO',
  'customer_data.company_name': 'Quarry Data',
  'dial_metric.is_live': false,
  'dial_metric.live_duration': 18.2,
  'dial_metric.has_voicemail': true,
  'dial_metric.left_voicemail': true,
  'user_log.disposition': 'Left Voicemail',
  'user_log.purpose': 'Cold call',
  'user_log.source': 3,
  ...script(
    [
      [true, "Hi, you've reached Elena. Leave a message and I'll get back to you.", 4.0],
      [false, "Hi Elena, it's Sam from Corgi. We insure data infrastructure startups and I had a quick idea about your cyber cover. I'll try you again Thursday. Thanks.", 9.5],
    ],
    14.1,
  ),
});

const emailBrushOff = session({
  session_id: FIXTURE_IDS.emailBrushOff,
  started_at: sec('2026-10-22T09:12:30Z'),
  customer_address: '+44 20 7946 0958',
  resource_id: 'usr_c41e88',
  duration: 63.0,
  customer_words: 19,
  agent_words: 44,
  'customer_data.name': 'Tom Becker',
  'customer_data.title': 'Founder & CEO',
  'customer_data.company_name': 'Fernway Ltd',
  'customer_data.custom_fields': JSON.stringify({ hubspot_contact_id: '90210864', Email: 'tom@fernway.example' }),
  'dial_metric.live_duration': 41.0,
  'sales_metric.has_prospect': true,
  'sales_metric.has_offer_email': true,
  'user_log.disposition': 'Send Info',
  'user_log.sentiment': 'Negative',
  'user_log.purpose': 'Cold call',
  'user_log.source': 12,
  ...script(
    [
      [false, 'Hi Tom, Alex from Corgi, we insure early-stage fintechs. Got a minute?', 3.6],
      [true, 'Not really. Just send me an email.', 1.8],
      [false, 'Happy to. So it is worth reading, is the bigger worry D&O for the board or E&O for the product?', 5.2],
      [true, "Look, just put it in an email and I'll read it when I can.", 2.6],
      [false, "Will do, I'll keep it to three lines. Thanks Tom.", 2.4],
    ],
    17.5,
  ),
});

const notInterested = session({
  session_id: FIXTURE_IDS.notInterested,
  started_at: sec('2026-10-22T19:44:18Z'),
  customer_address: '212-555-0164',
  resource_id: 'usr_c41e88',
  duration: 58.7,
  customer_words: 17,
  agent_words: 39,
  'customer_data.name': 'Rachel Kim',
  'customer_data.title': 'VP Operations',
  'customer_data.company_name': 'Brightlane Logistics',
  'dial_metric.live_duration': 34.4,
  'sales_metric.has_prospect': true,
  'sales_metric.has_obj_not_relevant': true,
  'user_log.disposition': 'Not Interested',
  'user_log.sentiment': 'Negative',
  'user_log.purpose': 'Cold call',
  ...script(
    [
      [false, "Hi Rachel, it's Alex from Corgi. Is now a bad time?", 2.7],
      [true, "What's this about?", 1.1],
      [false, "We insure growth-stage companies. I wanted to ask how you're handling employment practices cover as you hire.", 5.4],
      [true, "We're all set, thanks. Not interested.", 1.9],
      [false, "Understood. If that changes at renewal, would it be alright if I checked back in the spring?", 4.2],
      [true, 'No, please take me off your list.', 1.7],
    ],
    16.0,
  ),
});

/** Excluded by `dial_metric.live_duration >= 30`. */
const noAnswer = session({
  session_id: FIXTURE_IDS.noAnswer,
  started_at: sec('2026-10-22T19:41:02Z'),
  customer_address: '+1 212 555 0164',
  resource_id: 'usr_c41e88',
  duration: 31.0,
  customer_joined: false,
  end_reason: 'END_REASON_CUSTOMER_NOT_JOINED',
  'customer_data.name': 'Rachel Kim',
  'customer_data.company_name': 'Brightlane Logistics',
  'dial_metric.is_connected': false,
  'dial_metric.is_live': false,
  'dial_metric.sip_code': 0,
  'user_log.disposition': 'No Answer',
  'user_log.source': 2,
});

/** Excluded by `conversation_type = 1`. */
const messaging = session({
  session_id: FIXTURE_IDS.messaging,
  started_at: sec('2026-10-21T12:00:00Z'),
  conversation_type: 'CONVERSATION_TYPE_MESSAGING',
  address_type: 'ADDRESS_TYPE_WEB',
  customer_address: 'linkedin:priya-raman',
  resource_id: 'usr_7f3a1c',
  'customer_data.name': 'Priya Raman',
  'customer_data.company_name': 'Lumenfold AI',
  'dial_metric.is_dial': false,
  'dial_metric.is_connected': false,
  'dial_metric.sip_code': 0,
});

/** The six connected calls, newest first (as session-list returns them). */
export const FIXTURE_CALLS: SessionRecord[] = [notInterested, emailBrushOff, voicemail, gatekeeper, broker, booked];

/** Everything the fake API serves, including the sessions filters should drop. */
export const FIXTURE_RECORDS: SessionRecord[] = [...FIXTURE_CALLS, noAnswer, messaging];

/** The select used to build FIXTURE_SESSION_LIST (the docs' minimal call-list body). */
export const FIXTURE_SESSION_LIST_SELECT = [
  'session_id',
  'started_at',
  'resource_id',
  'customer_address',
  'customer_data.name',
  'customer_data.title',
  'customer_data.company_name',
  'user_log.disposition',
  'turn_data.texts',
  'turn_data.is_customers',
  'turn_data.starts',
] as const;

/** Positional rows, exactly as session-list-v6 returns them for FIXTURE_SESSION_LIST_SELECT. */
export const FIXTURE_SESSION_LIST: unknown[][] = FIXTURE_CALLS.map((r) => FIXTURE_SESSION_LIST_SELECT.map((c) => r[c]));

const ENUM_DEFAULTS = new Set(['CONVERSATION_TYPE_UNKNOWN', 'ADDRESS_TYPE_UNKNOWN', 'END_REASON_UNKNOWN', 'PLATFORM_UNKNOWN']);
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * A list record as `/session` proto JSON: camelCase nesting, enum names, default values omitted,
 * wordData never present.
 */
export function toProtoJson(record: SessionRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(record)) {
    if (path.startsWith('word_data.')) continue;
    if (value === '' || value === 0 || value === false || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && ENUM_DEFAULTS.has(value)) continue;
    const parts = path.split('.').map(camel);
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]!] = value;
  }
  return out;
}

/** GET /session (x-proto-as-json: true) for the booked call. */
export const FIXTURE_SESSION = toProtoJson(booked);
