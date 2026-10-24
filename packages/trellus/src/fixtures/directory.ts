/** GET /visible for a whole-team reader (so `team` is present). */
export const FIXTURE_VISIBLE = {
  team: { team_id: 'tm_corgi_outbound', team: 'Corgi Outbound' },
  users: [
    { user_id: 'usr_7f3a1c', user_name: 'Jordan Ellis' },
    { user_id: 'usr_2b9d4e', user_name: 'Sam Okafor' },
    { user_id: 'usr_c41e88', user_name: 'Alex Moreno' },
  ],
  user_id_to_email: {
    usr_7f3a1c: 'jordan@corgi.example',
    usr_2b9d4e: 'sam@corgi.example',
    usr_c41e88: 'alex@corgi.example',
  },
  groups: [{ user_group_id: 'grp_sdr_west', name: 'SDR West' }],
  memberships: [
    { user_group_id: 'grp_sdr_west', member_id: 'usr_7f3a1c', member_is_group: false },
    { user_group_id: 'grp_sdr_west', member_id: 'usr_2b9d4e', member_is_group: false },
    { user_group_id: 'grp_sdr_west', member_id: 'usr_c41e88', member_is_group: false },
  ],
};

/**
 * GET /bootstrap. The docs only say it carries "the key owner's account configuration and the exact
 * disposition, sentiment and purpose strings"; this shape is our guess, and the extractor in
 * dispositions.ts searches by key name rather than relying on it.
 */
export const FIXTURE_BOOTSTRAP = {
  user: { user_id: 'usr_7f3a1c', user_name: 'Jordan Ellis', email: 'jordan@corgi.example', team_id: 'tm_corgi_outbound' },
  team: { team_id: 'tm_corgi_outbound', team_name: 'Corgi Outbound', timezone: 'America/Los_Angeles' },
  settings: {
    parallel_lines: 3,
    disposition_options: [
      { label: 'Meeting Booked', is_positive: true },
      { label: 'Interested - Follow Up', is_positive: true },
      { label: 'Send Info', is_positive: false },
      { label: 'Call Back Later', is_positive: false },
      { label: 'Not Interested', is_positive: false },
      { label: 'Not Interested - Has Broker', is_positive: false },
      { label: 'Gatekeeper - Blocked', is_positive: false },
      { label: 'Left Voicemail', is_positive: false },
      { label: 'No Answer', is_positive: false },
      { label: 'Wrong Number', is_positive: false },
      { label: 'Do Not Call', is_positive: false },
      { label: 'Bad Timing - Q1', is_positive: false },
    ],
    sentiment_options: ['Positive', 'Neutral', 'Negative'],
    purpose_options: ['Cold call', 'Follow up', 'Renewal'],
  },
  integrations: { hubspot: { connected: true, portal_id: '48213377' } },
};
