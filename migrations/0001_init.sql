CREATE TABLE IF NOT EXISTS content_fields (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  source_path TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  purchase_timeframe TEXT,
  hear_about TEXT,
  comments TEXT,
  consent TEXT
);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);

CREATE TABLE IF NOT EXISTS edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  editor TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_editlog_entity ON edit_log(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_editlog_created ON edit_log(created_at);

CREATE TABLE IF NOT EXISTS eblast_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  editor TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  preview_text TEXT NOT NULL DEFAULT '',
  blocks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  recipient_count INTEGER,
  sent_count INTEGER,
  failed_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_eblast_campaigns_status ON eblast_campaigns(status);

CREATE TABLE IF NOT EXISTS eblast_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_eblast_sends_campaign ON eblast_sends(campaign_id);

INSERT OR IGNORE INTO content_fields (key, value) VALUES
  ('seo_title', 'Sunstone Towns — Freehold Townhomes in Vaughan | Edenbrook Homes'),
  ('seo_description', 'Coming soon to Vaughan: Sunstone Towns, a collection of freehold townhomes up to 2,427 sq.ft. from the $900''s by Edenbrook Homes. Register today for priority access.'),
  ('canonical_url', 'https://sunstonetowns.com/'),
  ('og_title', 'Sunstone Towns — Freehold Townhomes in Vaughan'),
  ('og_description', 'Freehold townhomes up to 2,427 sq.ft. from the $900''s. A community by Edenbrook Homes. Register for priority access.'),
  ('og_image', 'assets/images/hero.jpg'),
  ('favicon_href', 'assets/favicon.svg'),
  ('hero_headline', 'A Brighter' || char(10) || 'Way Home.'),
  ('hero_tag', 'Freehold Townhomes · Vaughan'),
  ('hero_sqft', '2,427'),
  ('hero_price_label', 'From the'),
  ('hero_price', '$900''s'),
  ('vision_heading', 'Designed' || char(10) || 'For The Way' || char(10) || 'Life Moves.'),
  ('vision_copy', 'Sunstone Towns is where inspired design meets everyday convenience in the heart of Vaughan. Freehold townhomes with the space you live today — and the life you''re building tomorrow.'),
  ('vision_image', 'vision-building.jpg'),
  ('vision_image_alt', 'Open parkland and meadow trails at sunset near Sunstone Towns'),
  ('homes_heading', 'Room to Live.' || char(10) || 'Space to Become.'),
  ('homes_copy', 'Thoughtfully laid out freehold townhomes with open-concept interiors, elevated finishes, and seamless indoor-outdoor living.'),
  ('homes_image_main', 'homes-living.jpg'),
  ('homes_image_main_alt', 'A couple relaxing in a sunlit open-concept living room'),
  ('homes_image_thumb1', 'homes-details.jpg'),
  ('homes_image_thumb1_alt', 'Quiet afternoon at home — wooden puzzle and coffee on the living room table'),
  ('homes_image_thumb2', 'homes-bedroom.jpg'),
  ('homes_image_thumb2_alt', 'Primary bedroom with floor-to-ceiling windows'),
  ('homes_image_side', 'homes-patio.jpg'),
  ('homes_image_side_alt', 'Reading with a coffee on a private outdoor terrace'),
  ('setting_heading', 'Close to' || char(10) || 'What Counts.'),
  ('setting_lede', 'A connected address in Vaughan with transit, shopping, dining, and major routes just minutes away.'),
  ('map_heading', 'Everything Nearby.'),
  ('map_lede', 'Explore the amenities, transit, and green space that surround Sunstone Towns — click any point to locate it on the map.'),
  ('community_heading', 'Rooted Here.' || char(10) || 'Connected Everywhere.'),
  ('community_copy', 'Beautifully planned streetscapes, green spaces, and gathering places create a neighbourhood where connections grow and life comes together.'),
  ('community_image', 'community-trail.jpg'),
  ('community_image_alt', 'Cyclists on the community trail through autumn green space'),
  ('register_heading', 'Be First' || char(10) || 'in Line.'),
  ('register_lede', 'Register for priority access to floorplans, pricing and updates.'),
  ('hero_images', '[{"file":"hero.jpg","alt":"A GO train passing the wooded trail network beside Sunstone Towns"},{"file":"hero-2.jpg","alt":"Vaughan Mills shopping and entertainment centre near Sunstone Towns"},{"file":"hero-3.jpg","alt":"Canada''s Wonderland amusement park near Sunstone Towns"},{"file":"hero-4.jpg","alt":"Community recreation centre near Sunstone Towns"}]'),
  ('homes_specs', '[{"value":"2, 3, & 4","label":"Bedrooms"},{"value":"Up to 2,427","label":"Sq. Ft."},{"value":"Private","label":"Outdoor Space"}]'),
  ('setting_items', '[{"title":"Go Transit","place":"Rutherford GO Station","distance":"6 min walk","image":"setting-transit.jpg","alt":"GO Transit train at a nearby Vaughan station"},{"title":"Shop & Dine","place":"Vaughan Mills","distance":"5 min drive","image":"setting-shops.jpg","alt":"Friends sharing an outdoor dinner under string lights"},{"title":"Top-Rated Schools","place":"Stephen Lewis Secondary","distance":"4 min drive","image":"setting-schools.jpg","alt":"Stephen Lewis Secondary School, 555 Autumn Hill Blvd, Thornhill"}]'),
  ('thankyou_headline', 'Thank You.'),
  ('thankyou_lede', 'You''re on the list. A member of the Sunstone Towns team will be in touch soon with floorplans, pricing, and priority updates.'),
  ('thankyou_note', 'In the meantime, take another look around the community.');
