-- ===========================================================================
-- Synthetic development seed
-- ---------------------------------------------------------------------------
-- SYNTHETIC DATA ONLY. Every name, phone number and identifier below is
-- invented. No real student, guardian, NID, birth certificate number or
-- fingerprint appears here, and none ever should: the brief forbids real
-- personal data in test fixtures.
--
-- The phone numbers use the +88013xxxxxxxx range with obviously sequential
-- digits so they cannot collide with a live Bangladeshi subscriber.
--
-- This file creates no auth users. Accounts are provisioned separately by
-- scripts/seed-auth-users.mjs, which uses the Supabase Admin API, because
-- passwords and identities belong to Supabase Auth rather than to SQL.
--
-- UUIDs are fixed rather than generated so that tests and documentation can
-- refer to a specific student or class by id.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- School branding and policy
-- --------------------------------------------------------------------------
insert into public.school_settings (
  id, name, short_name, email, office_phone, address,
  timezone, currency, default_locale,
  daily_sms_enabled, daily_sms_grace_minutes, daily_sms_earliest_time
)
values (
  true, 'School', 'SCH', 'office@school.example', '+8801300000000',
  'Dhaka, Bangladesh', 'Asia/Dhaka', 'BDT', 'en',
  false, 45, '16:00'
)
on conflict (id) do nothing;

-- Bangladesh: Friday and Saturday. Postgres dow — 0 Sun .. 5 Fri, 6 Sat.
insert into public.school_weekends (weekday) values (5), (6)
on conflict do nothing;

-- --------------------------------------------------------------------------
-- Academic year and terms
-- --------------------------------------------------------------------------
insert into public.academic_years (id, name, starts_on, ends_on, is_current) values
  ('a0000000-0000-4000-8000-000000000001', '2026', '2026-01-01', '2026-12-31', true)
on conflict (id) do nothing;

insert into public.terms (id, academic_year_id, name, sequence, starts_on, ends_on,
                          attendance_window_start, attendance_window_end, status) values
  ('17000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'First Term',  1, '2026-01-01', '2026-04-30', '2026-01-01', '2026-04-30', 'closed'),
  ('17000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'Second Term', 2, '2026-05-01', '2026-08-31', '2026-05-01', '2026-08-31', 'active'),
  ('17000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'Annual Exam', 3, '2026-09-01', '2026-12-31', '2026-09-01', '2026-12-31', 'upcoming')
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Classes: Play, Nursery, Class 1-10. The authority may add more.
-- --------------------------------------------------------------------------
insert into public.classes (id, name, level_order) values
  ('c1000000-0000-4000-8000-000000000001', 'Play',     1),
  ('c1000000-0000-4000-8000-000000000002', 'Nursery',  2),
  ('c1000000-0000-4000-8000-000000000003', 'Class 1',  3),
  ('c1000000-0000-4000-8000-000000000004', 'Class 2',  4),
  ('c1000000-0000-4000-8000-000000000005', 'Class 3',  5),
  ('c1000000-0000-4000-8000-000000000006', 'Class 4',  6),
  ('c1000000-0000-4000-8000-000000000007', 'Class 5',  7),
  ('c1000000-0000-4000-8000-000000000008', 'Class 6',  8),
  ('c1000000-0000-4000-8000-000000000009', 'Class 7',  9),
  ('c1000000-0000-4000-8000-00000000000a', 'Class 8',  10),
  ('c1000000-0000-4000-8000-00000000000b', 'Class 9',  11),
  ('c1000000-0000-4000-8000-00000000000c', 'Class 10', 12)
on conflict (id) do nothing;

-- One section per class. The UI hides the section selector when a class has
-- only one, but the row exists so roll numbers stay uniquely constrained.
insert into public.sections (id, class_id, name, capacity)
select
  ('5ec00000-0000-4000-8000-0000000000' || lpad(c.level_order::text, 2, '0'))::uuid,
  c.id, 'A', 40
from public.classes c
on conflict (class_id, name) do nothing;

-- --------------------------------------------------------------------------
-- Subjects
-- --------------------------------------------------------------------------
insert into public.subjects (id, name, name_bn, code) values
  ('50b00000-0000-4000-8000-000000000001', 'Bangla',          'বাংলা',        'BAN'),
  ('50b00000-0000-4000-8000-000000000002', 'English',         'ইংরেজি',       'ENG'),
  ('50b00000-0000-4000-8000-000000000003', 'Mathematics',     'গণিত',         'MAT'),
  ('50b00000-0000-4000-8000-000000000004', 'Science',         'বিজ্ঞান',       'SCI'),
  ('50b00000-0000-4000-8000-000000000005', 'Social Science',  'সমাজ বিজ্ঞান',  'SOC'),
  ('50b00000-0000-4000-8000-000000000006', 'Religion',        'ধর্ম',          'REL'),
  ('50b00000-0000-4000-8000-000000000007', 'ICT',             'আইসিটি',       'ICT')
on conflict (id) do nothing;

-- Classes 1-10 study the first five subjects; Play and Nursery study three.
insert into public.class_subjects (academic_year_id, class_id, subject_id)
select 'a0000000-0000-4000-8000-000000000001', c.id, s.id
from public.classes c
cross join public.subjects s
where (c.level_order <= 2 and s.code in ('BAN', 'ENG', 'MAT'))
   or (c.level_order > 2 and s.code in ('BAN', 'ENG', 'MAT', 'SCI', 'SOC'))
on conflict do nothing;

-- --------------------------------------------------------------------------
-- Grading scale
-- ---------------------------------------------------------------------------
-- CONFIRMED BY THE OWNER (phase 5), no longer a placeholder:
--
--   * Standard GPA-5 bands, below.
--   * A student must reach the pass mark in EVERY subject to pass the term
--     (grading_scales.pass_rule = 'all_subjects', the column default).
--   * A failed subject prints GPA 0.00 and the failing grade, the Bangladeshi
--     convention (fail_zeroes_gpa, the column default). The averaged figure
--     and the percentage's own band are kept in each result's snapshot.
--
-- Still nothing in application code assumes these numbers: they are read from
-- these tables, and the authority can change them at /authority/grading.
-- Retake policy and missing-mark handling beyond an explicit absence remain
-- open (docs/decisions-for-owner.md).
-- --------------------------------------------------------------------------
insert into public.grading_scales (id, name, academic_year_id, is_default, subject_pass_pct) values
  ('9ab00000-0000-4000-8000-000000000001', 'GPA 5.0',
   'a0000000-0000-4000-8000-000000000001', true, 33.00)
on conflict (id) do nothing;

-- The seed named this scale "GPA 5.0 (placeholder)" before the owner confirmed
-- it, and `on conflict do nothing` above cannot correct a row that already
-- exists on a project seeded earlier.
update public.grading_scales
   set name = 'GPA 5.0'
 where id = '9ab00000-0000-4000-8000-000000000001'
   and name = 'GPA 5.0 (placeholder)';

insert into public.grade_bands (scale_id, grade, min_pct, max_pct, grade_point, is_pass) values
  ('9ab00000-0000-4000-8000-000000000001', 'A+', 80.00, 100.00, 5.00, true),
  ('9ab00000-0000-4000-8000-000000000001', 'A',  70.00,  79.99, 4.00, true),
  ('9ab00000-0000-4000-8000-000000000001', 'A-', 60.00,  69.99, 3.50, true),
  ('9ab00000-0000-4000-8000-000000000001', 'B',  50.00,  59.99, 3.00, true),
  ('9ab00000-0000-4000-8000-000000000001', 'C',  40.00,  49.99, 2.00, true),
  ('9ab00000-0000-4000-8000-000000000001', 'D',  33.00,  39.99, 1.00, true),
  ('9ab00000-0000-4000-8000-000000000001', 'F',   0.00,  32.99, 0.00, false)
on conflict (scale_id, grade) do nothing;

-- --------------------------------------------------------------------------
-- Fee types and rates
-- --------------------------------------------------------------------------
insert into public.fee_types (id, name, code, is_monthly, is_exam_fee, description) values
  ('fee00000-0000-4000-8000-000000000001', 'Monthly Tuition', 'TUITION',  true,  false,
   'Standard monthly class fee.'),
  ('fee00000-0000-4000-8000-000000000002', 'Coaching Fee',    'COACHING', true,  false,
   'Optional monthly coaching.'),
  ('fee00000-0000-4000-8000-000000000003', 'Exam Fee',        'EXAM',     false, true,
   'Charged per term examination.'),
  ('fee00000-0000-4000-8000-000000000004', 'Admission Fee',   'ADMISSION',false, false,
   'One-off charge at admission.')
on conflict (id) do nothing;

-- Tuition rises with class level. Amounts are illustrative.
insert into public.fee_rates (fee_type_id, academic_year_id, class_id, amount)
select 'fee00000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000001',
       c.id,
       300 + (c.level_order * 50)
from public.classes c
on conflict do nothing;

insert into public.fee_rates (fee_type_id, academic_year_id, class_id, amount) values
  ('fee00000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', null, 250.00)
on conflict do nothing;

-- --------------------------------------------------------------------------
-- Work shift for teacher fingerprint attendance
-- --------------------------------------------------------------------------
insert into public.work_shifts (id, name, starts_at, ends_at, grace_minutes, is_default) values
  ('58100000-0000-4000-8000-000000000001', 'Standard Day', '08:00', '14:00', 10, true)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- A demo fingerprint terminal
-- ---------------------------------------------------------------------------
-- Registered so the Add Teacher form can record a device-user-id mapping. No
-- real terminal is reachable: ip_address is in the TEST-NET-1 documentation
-- range (RFC 5737), which is guaranteed never to be routed. The mapping alone
-- transmits no attendance; that needs the on-site bridge built in phase 9.
-- --------------------------------------------------------------------------
insert into public.devices (id, name, model, serial_no, location, ip_address, port)
values (
  'de000000-0000-4000-8000-000000000001',
  'Main Gate Terminal (demo)', 'ZKTeco K40', 'SYNTHETIC-K40-0001',
  'Main gate', '192.0.2.10', 4370
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Teachers (synthetic)
-- --------------------------------------------------------------------------
insert into public.teachers (
  id, employee_code, full_name, gender, blood_group,
  father_name, mother_name, personal_phone, alternate_phone,
  education, designation, joined_on
) values
  ('7eac0000-0000-4000-8000-000000000001', 'T-001', 'Demo Teacher One',   'female', 'B+',
   'Demo Father One', 'Demo Mother One', '+8801300000101', '+8801300000201',
   'M.A. in Bangla', 'Senior Teacher', '2020-01-15'),
  ('7eac0000-0000-4000-8000-000000000002', 'T-002', 'Demo Teacher Two',   'male',   'O+',
   'Demo Father Two', 'Demo Mother Two', '+8801300000102', null,
   'M.Sc. in Mathematics', 'Teacher', '2021-06-01'),
  ('7eac0000-0000-4000-8000-000000000003', 'T-003', 'Demo Teacher Three', 'female', 'A+',
   'Demo Father Three', 'Demo Mother Three', '+8801300000103', null,
   'B.Ed., M.A. in English', 'Teacher', '2022-02-20')
on conflict (id) do nothing;

insert into public.teacher_private_ids (teacher_id, nid) values
  ('7eac0000-0000-4000-8000-000000000001', 'SYNTHETIC-NID-0001'),
  ('7eac0000-0000-4000-8000-000000000002', 'SYNTHETIC-NID-0002'),
  ('7eac0000-0000-4000-8000-000000000003', 'SYNTHETIC-NID-0003')
on conflict (teacher_id) do nothing;

-- --------------------------------------------------------------------------
-- Students (synthetic)
-- ---------------------------------------------------------------------------
-- Note the two siblings below: STU-2026-0003 and STU-2026-0004 deliberately
-- share one guardian phone number (+8801300000303) and sit in different
-- classes. This is the case the brief calls out, and the access tests rely on
-- it existing in the seed.
-- --------------------------------------------------------------------------
insert into public.students (
  id, registration_no, full_name, gender, date_of_birth, blood_group,
  father_name, mother_name, admitted_on
) values
  ('57000000-0000-4000-8000-000000000001', 'STU-2026-0001', 'Demo Student Alpha',
   'male',   '2015-03-12', 'B+',  'Demo Guardian A', 'Demo Mother A', '2026-01-05'),
  ('57000000-0000-4000-8000-000000000002', 'STU-2026-0002', 'Demo Student Beta',
   'female', '2015-07-24', 'O+',  'Demo Guardian B', 'Demo Mother B', '2026-01-05'),
  ('57000000-0000-4000-8000-000000000003', 'STU-2026-0003', 'Demo Sibling Elder',
   'female', '2013-11-02', 'A+',  'Demo Guardian S', 'Demo Mother S', '2026-01-05'),
  ('57000000-0000-4000-8000-000000000004', 'STU-2026-0004', 'Demo Sibling Younger',
   'male',   '2016-05-19', 'A+',  'Demo Guardian S', 'Demo Mother S', '2026-01-05'),
  ('57000000-0000-4000-8000-000000000005', 'STU-2026-0005', 'Demo Student Epsilon',
   'male',   '2014-09-30', 'AB+', 'Demo Guardian E', 'Demo Mother E', '2026-01-05')
on conflict (id) do nothing;

insert into public.student_private_ids (student_id, father_nid, mother_nid, birth_certificate_no) values
  ('57000000-0000-4000-8000-000000000001', 'SYNTHETIC-NID-1001', null, 'SYNTHETIC-BC-1001'),
  ('57000000-0000-4000-8000-000000000002', null, 'SYNTHETIC-NID-1002', null),
  ('57000000-0000-4000-8000-000000000003', 'SYNTHETIC-NID-1003', 'SYNTHETIC-NID-1004', 'SYNTHETIC-BC-1003'),
  ('57000000-0000-4000-8000-000000000004', 'SYNTHETIC-NID-1003', 'SYNTHETIC-NID-1004', 'SYNTHETIC-BC-1004'),
  ('57000000-0000-4000-8000-000000000005', 'SYNTHETIC-NID-1005', null, null)
on conflict (student_id) do nothing;

-- The sibling pair share +8801300000303. The schema permits this; the login
-- identifier is the registration number, never the phone.
insert into public.student_contacts (student_id, label, holder_name, phone, is_sms_target) values
  ('57000000-0000-4000-8000-000000000001', 'guardian', 'Demo Guardian A', '+8801300000301', true),
  ('57000000-0000-4000-8000-000000000002', 'guardian', 'Demo Guardian B', '+8801300000302', true),
  ('57000000-0000-4000-8000-000000000003', 'guardian', 'Demo Guardian S', '+8801300000303', true),
  ('57000000-0000-4000-8000-000000000004', 'guardian', 'Demo Guardian S', '+8801300000303', true),
  ('57000000-0000-4000-8000-000000000005', 'guardian', 'Demo Guardian E', '+8801300000305', true)
on conflict (student_id, phone) do nothing;

-- --------------------------------------------------------------------------
-- Enrollments — two siblings in different classes
-- --------------------------------------------------------------------------
insert into public.student_enrollments (
  student_id, academic_year_id, class_id, section_id, roll_no, status
) values
  -- Class 3
  ('57000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000005', '5ec00000-0000-4000-8000-000000000005', 1, 'active'),
  ('57000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000005', '5ec00000-0000-4000-8000-000000000005', 2, 'active'),
  ('57000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000005', '5ec00000-0000-4000-8000-000000000005', 3, 'active'),
  -- Elder sibling: Class 8
  ('57000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-00000000000a', '5ec00000-0000-4000-8000-000000000010', 1, 'active'),
  -- Younger sibling: Class 1
  ('57000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000003', '5ec00000-0000-4000-8000-000000000003', 1, 'active')
on conflict (student_id, academic_year_id) do nothing;

-- --------------------------------------------------------------------------
-- Teacher assignments
-- ---------------------------------------------------------------------------
-- Teacher One teaches Bangla to Class 3 only. The access tests use this to
-- confirm she cannot reach the Class 8 sibling's record.
-- --------------------------------------------------------------------------
insert into public.teacher_assignments (
  teacher_id, academic_year_id, class_id, section_id, subject_id, effective_from
) values
  ('7eac0000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000005', '5ec00000-0000-4000-8000-000000000005',
   '50b00000-0000-4000-8000-000000000001', '2026-01-01'),
  ('7eac0000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000005', '5ec00000-0000-4000-8000-000000000005',
   '50b00000-0000-4000-8000-000000000003', '2026-01-01'),
  ('7eac0000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-00000000000a', '5ec00000-0000-4000-8000-000000000010',
   '50b00000-0000-4000-8000-000000000002', '2026-01-01')
on conflict do nothing;

-- --------------------------------------------------------------------------
-- A small routine for Class 3 section A (Sunday to Thursday)
-- --------------------------------------------------------------------------
insert into public.routine_periods (
  academic_year_id, class_id, section_id, subject_id, teacher_id,
  weekday, period_no, starts_at, ends_at, effective_from
)
select
  'a0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000005',
  '5ec00000-0000-4000-8000-000000000005',
  v.subject_id::uuid,
  v.teacher_id::uuid,
  d.weekday,
  v.period_no,
  v.starts_at::time,
  v.ends_at::time,
  '2026-01-01'
from (values
  ('50b00000-0000-4000-8000-000000000001', '7eac0000-0000-4000-8000-000000000001', 1, '08:00', '08:45'),
  ('50b00000-0000-4000-8000-000000000003', '7eac0000-0000-4000-8000-000000000002', 2, '08:45', '09:30')
) as v(subject_id, teacher_id, period_no, starts_at, ends_at)
cross join (values (0), (1), (2), (3), (4)) as d(weekday)
on conflict do nothing;

-- --------------------------------------------------------------------------
-- Monthly tuition charges for the current year, January to the current month
-- --------------------------------------------------------------------------
insert into public.fee_charges (
  student_id, fee_type_id, academic_year_id, period_year, period_month, amount, due_on
)
select
  se.student_id,
  'fee00000-0000-4000-8000-000000000001',
  se.academic_year_id,
  2026,
  m.month,
  fr.amount,
  make_date(2026, m.month, 10)
from public.student_enrollments se
join public.fee_rates fr
  on fr.class_id = se.class_id
 and fr.academic_year_id = se.academic_year_id
 and fr.fee_type_id = 'fee00000-0000-4000-8000-000000000001'
cross join generate_series(1, 6) as m(month)
where se.status = 'active'
on conflict do nothing;

-- --------------------------------------------------------------------------
-- Library
-- --------------------------------------------------------------------------
-- --------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------
-- Cards follow the REVISED specification in docs/design-system.md section 3:
-- a coloured area carrying the subject and the audience, with the full title
-- below it. The PDF-first-page thumbnail design is cancelled, so
-- cover_image_path is deliberately left NULL here and everywhere.
--
-- `subject_label` is the big line; `class_id` and `class_to_id` give the
-- audience, which renders as "Class 3", "Class 3-8" or "Everyone". The colour
-- is the authority's choice; the text colour is computed from it and never
-- stored. One long title is included on purpose, so the three-line wrap and
-- the ellipsis are visible on a real card without anyone having to type one.
-- --------------------------------------------------------------------------
insert into public.library_books
  (title, title_bn, author, subject_label, category, class_id, class_to_id,
   card_color, drive_url, is_published)
values
  ('Demo Bangla Reader', 'ডেমো বাংলা পাঠ', 'Demo Author',
   'Bangla', 'Textbook',
   'c1000000-0000-4000-8000-000000000005', null,
   '#1f6b45',
   'https://drive.google.com/file/d/DEMO_PLACEHOLDER_1/view', true),

  ('Demo Mathematics Workbook', 'ডেমো গণিত অনুশীলন', 'Demo Author',
   'Mathematics', 'Workbook',
   'c1000000-0000-4000-8000-000000000005', null,
   '#155e75',
   'https://drive.google.com/file/d/DEMO_PLACEHOLDER_2/view', true),

  ('Demo School Handbook', null, 'School',
   'Reference', 'Reference', null, null,
   '#1f2937',
   'https://drive.google.com/file/d/DEMO_PLACEHOLDER_3/view', true),

  -- A deliberately long title, and an audience RANGE, so both behaviours are
  -- visible in the demo catalogue rather than only in a test.
  ('Essentials of Human Biology and Physiology for the Secondary Certificate, Volume II',
   'মাধ্যমিক সার্টিফিকেটের জন্য মানব জীববিজ্ঞান ও শারীরবিদ্যার মূল বিষয়, দ্বিতীয় খণ্ড',
   'Demo Author', 'Biology', 'Textbook',
   'c1000000-0000-4000-8000-00000000000b',
   'c1000000-0000-4000-8000-00000000000c',
   '#d9f2e4',
   'https://drive.google.com/file/d/DEMO_PLACEHOLDER_4/view', true)
on conflict do nothing;

-- The existing demo rows predate these columns, so bring them into line. The
-- insert above cannot, because `on conflict do nothing` leaves a present row
-- untouched.
update public.library_books
   set subject_label = coalesce(subject_label, 'Bangla'), card_color = coalesce(card_color, '#1f6b45')
 where title = 'Demo Bangla Reader';
update public.library_books
   set subject_label = coalesce(subject_label, 'Mathematics'), card_color = coalesce(card_color, '#155e75')
 where title = 'Demo Mathematics Workbook';
update public.library_books
   set subject_label = coalesce(subject_label, 'Reference'), card_color = coalesce(card_color, '#1f2937')
 where title = 'Demo School Handbook';
