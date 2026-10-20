-- ===========================================================================
-- 0038  One em dash was doubling the cost of every English result SMS
-- ---------------------------------------------------------------------------
-- Found in the phase 7 browser walkthrough. The notifications screen showed
-- the English result template as "2 segments, 96 characters", which is wrong on
-- its face: GSM-7 fits 160 characters in one segment.
--
-- The cause was a single character. The template read
--
--     {school}: {student} — {exam} result. ...
--                         ^ U+2014 EM DASH
--
-- and the em dash is not in the GSM 03.38 alphabet. One character outside that
-- alphabet forces the WHOLE message into UCS-2, where a segment is 70
-- characters rather than 160 — so a 96-character English message billed as two
-- segments instead of one. Every result SMS the school ever sent would have
-- cost twice what it needed to, for a piece of punctuation nobody would miss.
--
-- The arithmetic was never wrong; countSegments had it right all along. What
-- was missing was anyone being told WHICH character did it, so the segment
-- counter now reports that and the template editor names the offender and the
-- saving.
--
-- This replaces the em dash with a hyphen in the English templates. The Bangla
-- ones are left exactly as they are: Bengali cannot be GSM-7 at any price, so
-- there is nothing to save there and the dash is not the problem.
-- ===========================================================================

update public.notification_templates
   set body = replace(body, ' — ', ' - ')
 where language = 'en'
   and body like '%' || chr(8212) || '%';

-- Belt and braces for any wording the office typed itself: an en dash and a
-- "smart" apostrophe are the other two that catch people out, and both have
-- plain equivalents that read identically in a text message.
update public.notification_templates
   set body = replace(replace(replace(body, chr(8211), '-'), chr(8217), ''''), chr(8216), '''')
 where language = 'en'
   and (body like '%' || chr(8211) || '%'
     or body like '%' || chr(8217) || '%'
     or body like '%' || chr(8216) || '%');

comment on table public.notification_templates is
  'SMS bodies as configuration. {placeholders} are filled from notification_jobs.payload by the application. Keep English bodies inside GSM-7: one character outside it (an em dash, a smart quote) forces UCS-2 and halves the characters per billable segment.';
