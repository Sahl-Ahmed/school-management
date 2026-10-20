# Decisions needed from the owner

None of these block the next phase. Each is stored as configuration rather than
hard-coded, so answering one later is a data change, not a code change. What is
in place now is a documented default, not a guess presented as policy.

Eight already answered:

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
- **Grade and GPA scale** — confirmed in phase 5; see section 1 below for what
  was settled and the two parts of it still open.
- **Admit-card fee cutoff** — confirmed in phase 6: fees must be clear through
  the **exam's own month**. See section 2.
- **ID card fields and orientation** — confirmed in phase 6: the guardian's
  number on the front, the school's on the back, and **both** orientations
  built. See section 4, which also records exactly where that number appears.
- **Mid-term teacher change** — confirmed in phase 6: the outgoing teacher and
  their replacement are **each** reviewed. See section 5.

---

## 1. Grade and GPA scale  *(brief 12.1)*  — **mostly answered**

**Confirmed by the owner in phase 5, and implemented:**
- The standard GPA-5.0 bands — A+ 80–100 (5.0), A 70–79 (4.0), A− 60–69 (3.5),
  B 50–59 (3.0), C 40–49 (2.0), D 33–39 (1.0), F below 33 — with a 33% subject
  pass mark.
- **Failing one subject fails the term**, whatever the average
  (`grading_scales.pass_rule = 'all_subjects'`).
- A failed term prints **GPA 0.00 and the failing grade**, the Bangladeshi
  convention (`grading_scales.fail_zeroes_gpa`). The averaged figure and the
  percentage's own band are both kept in each result's frozen snapshot, so the
  marks-only view is never lost, and the student's sheet says in words why the
  two figures read as they do.
- An **explicit absence** scores zero for the subject, prints as "absent"
  rather than as 0, and is not a missing mark. A blank is refused at entry: a
  teacher must give every student a score or an absence before the subject can
  be submitted, and publication is refused while any mark is un-entered.

All of it remains configuration. The authority can change the bands, the pass
mark, the pass rule and the GPA convention at **/authority/grading** without a
code change, and each exam keeps the scale it was published under.

**Still to confirm — neither blocks anything built so far:**
- **Do the bands differ by class?** Play and Nursery may not be graded at all.
  There is a setting for the GPA half of this already
  (`grading_scales.no_gpa_below_level` prints marks and grades but no GPA up to
  a chosen class level); it is currently off, so every class gets a GPA. If
  those classes should not be graded at all, that is a further change.
- **Are retakes allowed, and does a retake replace or supplement the original?**
  Nothing is built for retakes. Today a corrected mark is an audited correction
  to the same exam, which is not the same thing as a retake sitting beside the
  first attempt.

## 2. Admit-card fee window  *(brief 12.2)*  — **answered**

**Confirmed in phase 6 and implemented:** monthly fees must be cleared through
**the exam's own month**, not the month before. Setting up a new exam's rule
derives the cutoff from the exam's start date automatically, so the office does
not have to remember the policy; the row stays editable per exam.

**Kept as the brief specifies, both still editable per exam:**
- **No outstanding amount is tolerated** (`allowed_outstanding = 0`).
- **Exceptions are off** (`allow_override = false`). Switching them on for one
  exam then requires an `authority_admin`, a typed reason, and records which
  checks were overridden; the card itself prints a line saying it was issued by
  exception.

With no rule configured at all, every card for that exam is blocked. That is
deliberate: nothing is asserted to be satisfied until the office says so.

## 3. School branding and contact details  *(brief 12.3)*

**Needed by:** phase 2 for screens, phase 6 for printed cards.

**Current placeholder:** name "School", `office@school.example`,
`+8801300000000`, no logo, no signature image.

**Still to confirm:** real school name, logo file, official email, office
number, address, and the head teacher's name, title and PNG signature.

## 4. ID card fields  *(brief 12.4)*  — **answered**

**Confirmed in phase 6 and implemented:**
- **Front:** photo, name (English and Bangla), class, section, roll,
  registration number, blood group, session, and the **guardian's phone
  number**.
- **Back:** school address, the **school office number**, a return-if-found
  note, and the QR code.
- **Both orientations** are built at PVC CR80 size — 54 x 85.6 mm portrait and
  85.6 x 54 mm landscape — and the office picks which template is the default.

**Where the guardian's number appears, exactly — settled in phase 7.** You asked
that the public QR page show the same student details the card prints, and that
a printed contact number's visibility match that deliberate choice. It now does:
the number is printed on the card AND shown on the page, so anyone who scans a
found card can read it.

Phase 6 had shipped these out of step — the card printed the number while the
page looked for a differently-named field and silently dropped it. Both now read
from one list (`src/lib/school/card-fields.ts`), with a test that a field the
card prints cannot be missing from the page.

What the public page shows: the school's name, logo, email and office number,
plus the student's name (and Bangla name), registration number, roll, class,
section, blood group, session and guardian phone — and nothing else. No
photograph: the card prints one, but publishing a child's face to anyone who
scans a found card is a different decision and you have not asked for it. Say
the word either way.

The database refuses parent names, NIDs, birth certificate numbers, fees, marks
and attendance in a card snapshot regardless of what any template asks for, and
that refusal holds even for the service role.

**Still worth knowing:** cards already printed keep whatever is on them.
Revoking a card kills its QR link immediately; it cannot unprint plastic. So if
the field list changes, the affected cards need physically replacing.

## 5. Mid-term teacher change and feedback  *(brief 12.5)*  — **answered**

**Confirmed in phase 6 and implemented:** when a teacher changes mid-term, the
student reviews **both** the outgoing teacher and their replacement, provided
each taught at least the minimum number of lessons. Form generation walks every
assignment that overlapped the term rather than only the one in force today, so
a teacher who left in week three is still reviewed for the lessons they gave.

**Minimum lessons taught** defaults to **1** and is set per round on the create
form. It counts **submitted** lessons only, the same basis as every attendance
figure in the system: a lesson nobody submitted did not demonstrably happen, so
it cannot be used to argue a teacher is reviewable.

A student with no forms — because their teachers taught too few lessons — is
excluded from the completion figures rather than counted as unfinished, and the
office screen says how many students that is.

## 6. Feedback questions and window  *(brief 12.6)*  — **partly answered**

**Settled in phase 6:** the comment box is **always offered and optional**, and
only the office can read comments. Teachers cannot read them at any
aggregation, and nothing records who wrote one.

**Still yours to decide — none of it blocks anything:**
- **The final question wording.** Three are proposed, in English and Bangla,
  and appear pre-filled and editable on the create-round form:
  1. Does this teacher explain the lesson clearly? / এই শিক্ষক কি পাঠ স্পষ্টভাবে বুঝিয়ে দেন?
  2. Can you ask this teacher questions comfortably? / আপনি কি এই শিক্ষককে সহজে প্রশ্ন করতে পারেন?
  3. Does this teacher start and finish the class on time? / এই শিক্ষক কি সময়মতো ক্লাস শুরু ও শেষ করেন?

  Replace them with whatever the school wants to ask; they are stored with each
  round, so a later round can ask something different. Two questions or three,
  your choice — the form supports dropping the third.
- **The response scale.** 1–5 is the default; 1–10, 1–4 and 1–3 are offered on
  the same form.
- **The window.** Each round takes an opens-at and closes-at, both optional —
  leave them blank and the round is controlled by its status alone. Nothing
  automatically ties the window to the exam dates yet; the office opens and
  closes it.

A note worth repeating: in a section where only one or two students answer, an
average can effectively identify the respondent. The analysis screen flags any
teacher-question pair with fewer than three responses and says so in words.

A note worth raising: in a section where only one or two students answer, an
average can effectively identify the respondent. `feedback_analysis()` flags
samples below a threshold for this reason.

## 7. Daily SMS timing and corrections  *(brief 12.7)*  — **open, but nothing is blocked**

**You have decided not to open a provider account yet.** Live delivery is
PENDING and is not claimed as working anywhere. Everything around it — the
templates, the rules, the queue, the duplicate prevention and the delivery
reporting — is built and tested in simulation, so connecting a provider later is
a credentials change rather than a rewrite.

**Already configurable, and currently set to:**
- The daily summary is **off** (`daily_sms_enabled = false`).
- A **45-minute** grace period after the last lesson ends.
- Never before **16:00** Asia/Dhaka.

All three are columns in school settings, changeable without a code change.

**Still to confirm, when you are ready:**
- The send time and grace period in practice.
- **What happens when attendance is corrected after a summary has gone.** The
  system will not silently send a second ordinary daily SMS. The options remain:
  no notice, an explicit correction notice, or office discretion. Nothing is
  built for this yet, because the answer changes what gets built.
- Who is notified about overdue teacher submissions, and after how long.
- The approximate monthly budget.

**One thing worth knowing before you choose a language.** Bangla cannot be sent
as GSM-7, so a Bangla message is billed at 70 characters per segment against 160
for English — the same sentence can cost three times as much. The template
editor shows the segment count as you type.

And a trap found in phase 7: **one character outside GSM-7 does the same thing
to an English message.** The shipped English result template contained an em
dash, which made a 96-character message cost two segments instead of one —
double, for a piece of punctuation. The editor now names any such character and
tells you the saving. If you write your own wording, watch for em dashes, en
dashes and curly quotes.

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
