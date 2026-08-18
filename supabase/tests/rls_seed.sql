-- Seeds a realistic salon for adversarial RLS testing.
--   Dana   — salon OWNER: admin on the salon AND stylist on her own chair
--   Rae    — 1099 booth renter, own tenant
--   Wes    — W-2 employee, records belong to the salon
--   Nina   — a client who books with BOTH Dana and Rae
set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dana@salon.test','x',now(),'{"full_name":"Dana Owner"}'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rae@salon.test','x',now(),'{"full_name":"Rae Renter"}'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wes@salon.test','x',now(),'{"full_name":"Wes Employee"}'),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nina@client.test','x',now(),'{"full_name":"Nina Client"}');

-- Tenants: the salon, plus a tenant for each independent practice.
insert into public.tenants (id, kind, name, parent_salon_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','salon','CosmoCutie Salon', null),
  ('aaaaaaaa-0000-0000-0000-000000000002','stylist','Dana''s Chair','aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000003','stylist','Rae''s Chair','aaaaaaaa-0000-0000-0000-000000000001');

-- Composable roles: Dana is admin of the salon AND a stylist on her own chair.
insert into public.tenant_members (tenant_id, profile_id, role, classification) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','admin','owner_operator'),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','stylist','owner_operator'),
  ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','stylist','contractor_1099'),
  -- Wes is W-2: he works under the SALON tenant, not his own.
  ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','stylist','employee_w2');

insert into public.stylist_settings (tenant_id) values
  ('aaaaaaaa-0000-0000-0000-000000000002'),
  ('aaaaaaaa-0000-0000-0000-000000000003');

-- Nina: ONE identity, TWO independent relationship records.
insert into public.clients (id, profile_id, full_name, phone) values
  ('cccccccc-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','Nina Client','+15550100');

insert into public.client_records (id, tenant_id, client_id) values
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000001');

insert into public.client_tags (tenant_id, client_record_id, tag) values
  ('aaaaaaaa-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000002','needs_extra_time');

insert into public.services (id, tenant_id, name, duration_minutes, price_cents) values
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','Dana Cut',60,9000),
  ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000003','Rae Balayage',180,28000);

-- Rae's revenue and book — the data Dana must never reach.
insert into public.appointments
  (id, tenant_id, stylist_id, client_id, client_record_id,
   starts_at, ends_at, buffer_starts_at, buffer_ends_at, total_price_cents)
values
  ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000002',
   '2026-09-01 14:00+00','2026-09-01 17:00+00','2026-09-01 13:30+00','2026-09-01 17:30+00', 28000);

insert into public.formulas (tenant_id, appointment_id, client_record_id, technique_notes) values
  ('aaaaaaaa-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000002','Rae secret balayage formula');

insert into public.payments (tenant_id, appointment_id, client_id, kind, status, amount_cents) values
  ('aaaaaaaa-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001','service','captured',28000);
