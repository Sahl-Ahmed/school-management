# Decisions needed from the owner

None of these block the next phase. Each is stored as configuration rather than
hard-coded, so answering one later is a data change, not a code change. What is
in place now is a documented default, not a guess presented as policy.

Three already answered:

- **Supabase project** — owner creates it; migrations are written and verified,
  steps are in [`setup.md`](setup.md).
- **Default UI language** — English first, with the text layer structured so
  Bangla can be added without rewriting components. Subject names already carry
  `name_bn`, and feedback questions carry `prompt_bn`.
- **Visual design** — a polished light interface in white, green and black,
  consistent across all three portals, with tasteful colour in charts and
  meters. Recorded in full in [design-system.md](design-system.md), which also
  carries the **revised Library card specification** that replaces the original
  brief's PDF-thumbnail design.

---

## 1. Grade and GPA scale  *(brief 12.1)*

**Needed by:** phase 5 (results).

**Current placeholder:** a GPA-5.0 scale in the seed — A+ 80–100 (5.0), A
70–79 (4.0), A− 60–69 (3.5), B 50–59 (3.0), C 40–49 (2.0), D 33–39 (1.0),
F below 33 — with a 33% subject pass mark.

**Still to confirm:**
- Do the bands differ by class? Play and Nursery may not be graded at all.
- How does a missing mark differ from a zero in the overall result?
- Are retakes allowed, and does a retake replace or supplement the original?
- Does failing one subject fail the whole term?

## 2. Admit-card fee window  *(brief 12.2)*

**Needed by:** phase 6.

**Current default:** `admit_card_rules` requires monthly fees cleared through a
configured month plus the exam fee paid, with zero tolerated outstanding, and
`allow_override = false`.

**Still to confirm:**
- Through which month must fees be cleared for each exam — the month before the
  exam, or the exam month itself?
- Is any outstanding amount tolerated?
- Is an audited exceptional override permitted at all? It is **off** until you
  say otherwise. If enabled it requires `authority_admin` and records the
  overridden checks plus a reason.

## 3. School branding and contact details  *(brief 12.3)*

**Needed by:** phase 2 for screens, phase 6 for printed cards.

**Current placeholder:** name "School", `office@school.example`,
`+8801300000000`, no logo, no signature image.

**Still to confirm:** real school name, logo file, official email, office
number, address, and the head teacher's name, title and PNG signature.

## 4. ID card fields  *(brief 12.4)*

**Needed by:** phase 6. **This one has a privacy consequence**, so it deserves
the most care.

Whatever is printed on the card is also what the public QR page shows. The
database refuses parent names, NIDs, birth certificate numbers, fees, marks and
attendance in a card snapshot regardless of what is chosen here.

**Still to confirm:**
- Front fields. Proposed: photo, name, class, section, roll, registration
  number, blood group, session.
- Back fields. Proposed: school address, office number, a return-if-found note.
- **Is an emergency contact number printed?** If yes, it becomes publicly
  visible to anyone who scans the card. Guardians should be told this before
  cards are issued.
- Portrait or landscape.

## 5. Mid-term teacher change and feedback  *(brief 12.5)*

**Needed by:** phase 6.

**Current default:** `feedback_campaigns.min_periods_taught = 1`.

**Still to confirm:**
- If a teacher changes mid-term, does the student review both, only the current
  one, or only whoever taught the majority?
- What is the minimum number of periods before a teacher is reviewable?

Assignments are already effective-dated, so either answer is supportable.

## 6. Feedback questions and window  *(brief 12.6)*

**Needed by:** phase 6.

**Current default:** no questions seeded; the scale defaults to 1–5.

**Still to confirm:**
- The 2–3 final rating questions, in English and Bangla.
- The response scale — 1–5, or 1–10?
- When does feedback open and close relative to each term's exam?
- Is the free-text comment box always available, and who may read it? Currently
  authority only, and teachers can never read it at any aggregation.

A note worth raising: in a section where only one or two students answer, an
average can effectively identify the respondent. `feedback_analysis()` flags
samples below a threshold for this reason.

## 7. Daily SMS timing and corrections  *(brief 12.7)*

**Needed by:** phase 7.

**Current default:** `daily_sms_enabled = false`, 45-minute grace period after
the last scheduled period, never before 16:00 Asia/Dhaka.

**Still to confirm:**
- Send time and grace period.
- What happens when attendance is corrected after the summary has gone? The
  system will not silently send a second ordinary daily SMS. The options are: no
  notice, an explicit correction notice, or office discretion.
- Who is notified about overdue teacher submissions, and after how long?
- Approximate monthly SMS budget. Bangla text costs 70 characters per billable
  segment against 160 for English, so message language materially changes cost.

## 8. K40 terminal and the on-site PC  *(brief 12.8)*

**Needed by:** phase 8. **Cannot be completed without the physical device.**

**Still to confirm:**
- Exact firmware version on the unit, and whether it speaks the standard ZKTeco
  protocol on TCP 4370.
- Will the on-site PC stay powered during school hours? The bridge queues and
  replays when it is off, but gaps in `last_sync_at` will show.
- Fallback expectation if the LAN or internet is down for a day.
- Who at the school enrolls fingers and enters the device user id?

Until the device is tested, teacher fingerprint attendance will be reported as
**not working**, however complete the code looks.

---

## Decisions already made in the build

Recorded here so they can be reversed deliberately rather than discovered.

| Decision | Choice | Reversible? |
| --- | --- | --- |
| Teacher login identifier | Employee code + password. The brief does not specify one. | Yes — small change in `lib/auth/identity.ts`. |
| Sections | Every class has at least one; the brief treats them as optional. | Costly later. See [data-model.md](data-model.md#sections-are-required). |
| Student photos | Private bucket, served by signed URL, not public. | Yes. |
| QR branding | School name/email/phone read live, not frozen into the snapshot, so a corrected office number appears on already-issued cards. | Yes. |
| Feedback retraction | Impossible by construction — the price of real anonymity. | No. Changing it means abandoning anonymity. |
| Library covers | PDF-first-page thumbnails cancelled; coloured subject/audience cards instead. | Yes — but the old design should not be built. |
| Audit of feedback answers | Not audited, for the same reason. | No. |
| Admit card with no rule configured | Blocked, not allowed. | Yes, but defaulting to allow would be unsafe. |
