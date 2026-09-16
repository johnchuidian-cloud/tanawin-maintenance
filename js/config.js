// Tanawin Maintenance — public client config.
//
// The anon key is safe to ship: with RLS on and anon holding no policy on any
// table, it can do exactly one thing — read the login roster of names.
// Both values are filled from .env.local by `node scripts/fill-config.mjs`
// (never by hand) so the same source of truth feeds this file and _headers.

const SUPABASE_URL = 'https://kyxpzjxftfqbwpnvntqi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5eHB6anhmdGZxYndwbnZudHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzY0MTksImV4cCI6MjEwNTExMjQxOX0.cbMxPQX4Ab9P_Ac1BpV7QZt8M7CYpAWOx1M71831Lu8';

// Hub launcher, role-aware like Menu: owner/admin → full hub, staff → /staff.
const HUB_URL = 'https://tanawin-hub.tanawinbnb.workers.dev/';
const HUB_STAFF_URL = 'https://tanawin-hub.tanawinbnb.workers.dev/staff';

// Hidden-login convention (Menu's approach). The prefix is public; the
// secret is the 4 digits. Must match supabase/functions/manage-staff.
const AUTH_EMAIL_DOMAIN = 'tanawin.maintenance';
const AUTH_PASSWORD_PREFIX = 'tanawin-maintenance-v1:';

// Trade categories on a work order. A list, not a table: nine words that
// have not needed changing in any Tanawin app.
const CATEGORIES = ['Electrical', 'Plumbing', 'Aircon', 'Hardware', 'Furniture', 'Painting', 'Grounds', 'Appliance', 'Other'];
const PRIORITIES = ['routine', 'soon', 'urgent'];
const EQUIPMENT_CATEGORIES = ['Power tools', 'Grounds', 'Pool', 'Hand tools', 'Consumables'];
const CONDITIONS = ['working', 'service due', 'broken'];

// "Fixed recently" on the dashboard = completed within this many days.
const RECENT_DAYS = 7;
