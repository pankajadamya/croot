# Croot UX review

_5 November 2026 · review only, no changes made_

The goal is for every journey to feel painless: a guest should finish a review without second-guessing, an organiser should get a retreat live without hunting for switches, and a visitor should understand the page at a glance.

This review covers four journeys: **guests** (invite link to private response page), **organisers** (setting up, inviting, publishing), **public visitors** (retreat page, stories, album, updates sign-up) and **sign-in / admin**. Findings come from reading the code and from using the local app. Items marked _(unverified)_ are inferred from the code and still need checking in a browser.

Priority key:

- **P1:** blocks a journey or breaks a promise.
- **P2:** causes real friction or confusion.
- **P3:** polish.

---

## Decisions (5 November 2026)

1. **Album photos are published once the organisation owner approves them.** Guests' album photos go through the same approval as story photos. As soon as the owner approves, they appear in the album straight away. The owner can still take any photo out later. Guest wording should say exactly this, for example: "Shared in the public album once the organiser approves it. They can take it out at any time." (This replaces finding 5 / Guest P1 "Album photos skip approval": the fix is to add approval *and* match the wording.)
2. **The logo stays lowercase "croot", always set in a sans-serif typeface.** The current logo SVGs already use Arial/Helvetica. The work is to check every other place the name is drawn as a logo (share-kit images and any text wordmark) and make sure it uses sans-serif. Ordinary sentences can still say "Croot".
3. **A public album is fine and intended.** It can be shared with friends and family; the "thank-you" framing just needs updating in the organiser wording.
   - **Open point:** you described the album as "a unique public link that isn't guessable". Today it isn't. It lives at a predictable address, `/o/<organisation>/r/<retreat>/album`, and the retreat page links to it. Before the work starts, decide which you want:
     - **(a)** Keep it as it is: public, predictable and linked from the retreat page.
     - **(b)** Bring back a random, unguessable address, and stop linking it from the public page, so only people given the link can find it.

---

## Fix these first

| # | Problem | Journey | Why it hurts |
|---|---|---|---|
| 1 | New programmes start as **Draft**, and draft guest links show "Review not found" | Organiser → guest | Organisers send links that don't work, and nothing warns them. |
| 2 | **Guests aren't emailed**; links must be copied by hand and can't be shown again | Organiser | This is the heaviest manual step, and it's easy to lose links. |
| 3 | Re-opening the private response page **issues a new link and kills the bookmarked one** | Guest | It breaks "bookmark this page"; the dead link then leaves the guest with nowhere to go. |
| 4 | The **anonymous note can vanish** on refresh or a dropped tab, with no warning | Guest | The guest loses their words silently. |
| 5 | **Album photos go public with no approval**, while the copy promises organisers check every photo | Guest, organiser | It breaks a promise about photos. |
| 6 | **Editing a sent review** takes four or more hops, with contradictory instructions | Guest | Guests give up on corrections. |
| 7 | **Three different ways of saving**, and unsaved Overview edits are lost on tab switch | Organiser | Organisers can't tell whether their work is saved. |
| 8 | **No single "is my page live?" view**: status, opening, theme and stories are each published in a different place | Organiser | This is the "why can't I see my content?" confusion already reported. |
| 9 | The retreat page **opens on the album**, not on what the page is or who it's from | Visitor | First impressions are unclear, and the heading order is wrong. |
| 10 | **"Sign in with a password" is offered to everyone**, with no reset | All | It's a dead end for anyone who signed up with a code or Google. |

---

## 1. Guests: invite link → review → private page

### P1

- **Anonymous note can be lost** (`InviteFlow.tsx`, steps 3–5).
  - The note lives only in memory, and the "leave this page?" guard ignores it.
  - A refresh, a closed tab, or a phone dropping the tab while in the camera picker on step 4 wipes it silently.
  - _Fix:_ keep the note in `sessionStorage` until it's sent, include it in the leave warning, and say plainly if it was lost.
- **Bookmarked private link stops working** (`invites.ts`, `/submit`; `Receipt.tsx`).
  - Each "Open my private response page", and each re-send after an edit, issues a fresh token, while the page says "Bookmark this page".
  - The old link then shows a dead-end "link not valid" screen.
  - _Fix:_ keep one stable private link per response (re-show it rather than reissue). Give the "link unavailable" screen links to sign in, My reviews, and contacting the organiser.
- **Album photos skip approval** (`server/src/lib/album.ts`, `albumWhere`).
  - The form says the organiser checks every photo before publishing, but album sharing and album uploads go public immediately.
  - _Fix:_ choose one and make the code and the copy match. Either moderate album photos like story photos, or say clearly "Photos you add to the album appear straight away for anyone to see."
- **Editing a sent review is a maze** (`InviteFlow.tsx`, `Receipt.tsx`, `MyReviews.tsx`).
  - Sign-in always returns to `/my-reviews`, not the review the guest was on.
  - The guest then has to find it, choose "View or edit", then "Edit my review".
  - The private page says "open your original invitation link to update", but that link now asks them to sign in.
  - _Fix:_ return to the exact review after sign-in, reopen it automatically, and use one consistent instruction everywhere.

### P2

- **Failed send leaves the note's status unclear.** The note is sent before the review; if the review then fails, the summary says "No anonymous note", inviting a duplicate. _Fix:_ send the note after the review succeeds, or show "Your note was sent".
- **"Load latest" discards unsaved typing** with no warning when two devices conflict. _Fix:_ warn first, or show both versions.
- **Consent choices don't add up.**
  - "May be published with my story" stays on even with no story, or with story publishing off.
  - Review & send then counts photos "with publishing permission" next to "Nothing will be published".
  - The social media and album choices aren't in the final summary.
  - _Fix:_ disable or explain photo publishing when the story isn't shared, and list every choice before sending.
- **"Remove photo" deletes immediately**, with no confirm or undo. _Fix:_ undo for a few seconds.
- **Private page permissions are hard to match to photos.**
  - Photos show as "Photo 1" or "A photo", with no thumbnail.
  - Album uploads appear twice.
  - "Takes effect on the public site" also shows for contact and marketing withdrawals.
  - _Fix:_ thumbnails, one row per photo, and wording per choice.
- **On phones the photo panel takes up to 62% of the screen on every step**, and "Hide photos" isn't remembered (`PhotoPanel.tsx`). _Fix:_ collapse it after Welcome on mobile and remember the choice.
- **Album page gaps** (`AlbumPage.tsx`).
  - A failed "Stop sharing" shows nothing.
  - "Stop sharing" is only reachable inside the full-screen viewer.
  - Uploads go public with no preview.
  - The locked screen has no way back.
- **Accessibility.**
  - Field hints aren't linked to their inputs, so screen readers miss "isn't saved as you go" and "expires in 10 minutes" (`Controls.tsx`, `Field`).
  - The "Add photos" labels likely show no keyboard focus ring _(unverified)_.

### P3

- "Begin reflection" is jargon, and "about seven minutes" undersells ten rating areas plus story, photos and choices.
- "This form is closed" has no contact or home link.
- "This creates a fresh private link…" sits under two buttons and doesn't say which one it means.
- File size and photo limits only appear as errors; state them up front.
- "Download my data (JSON)" → "Download a copy of everything you sent".
- Permission labels speak as the guest ("Publish my story") while descriptions address the organiser ("You may publish…"). Pick one voice.
- The step indicator isn't clickable, so fixing an earlier step means several Back clicks.

---

## 2. Organisers: set up → invite → publish

### P1

- **Draft programmes silently block guests** (`RetreatNew.tsx`, `OverviewTab.tsx`, `InvitationsTab.tsx`, `server/src/lib/invites.ts`).
  - New programmes are Draft, and while Draft, guest links say "Review not found" and the public page returns 404.
  - Invitations still generate links with no warning.
  - Going live means finding a Status dropdown in the third Overview card and pressing Save.
  - _Fix:_ a "Go live" checklist banner on every tab (status, opening published, links sent) with a one-click **Start collecting**. Warn or block when making links for a Draft programme.
- **Guests aren't emailed** (`InvitationsTab.tsx`).
  - Links must be copied and sent by hand, and can't be shown again after leaving the page.
  - "Copy all" pushes organisers into a spreadsheet and mail merge.
  - _Fix:_ **Send invitations** by email (SES is already set up), with resend and a delivery status. Until then, warn before leaving the page with uncopied links.
- **Three ways of saving.**
  - Overview has a "Save settings" button.
  - Site switches, album settings and the website field save instantly or when you leave the field.
  - The opening and theme use Save draft → Publish.
  - The same switch control behaves differently in different places, and the slideshow switches exist in both Overview and Site.
  - The star-ratings switch says "Takes effect straight away" but needs Save.
  - Switching tabs throws away unsaved Overview edits.
  - _Fix:_ auto-save everywhere except the two Publish steps, remove the duplicate switches, and add an unsaved-changes guard.
- **Overview "Saved" message probably never shows** (`OverviewTab.tsx`; the form is keyed on `retreat.updatedAt`, so it remounts on save). _Fix:_ key on `retreat.id`, or keep the saved flag outside the form.
- **No single "is it live?" view** (`RetreatWorkspace.tsx`, `SiteTab.tsx`, `AppearanceTab.tsx`).
  - The public link is tucked inside a collapsed "Share link" box.
  - Status, opening, theme, slideshow and stories are each live in a different place.
  - _Fix:_ a **Public page** panel at the top: Live / Not live and why, each part's state, and **Open public page**.

### P2

- **Public page settings sit under "Collecting responses"** in Overview: showing stories, contact visibility, star ratings and slideshows. _Fix:_ move them to Public site.
- **Overview is overloaded.**
  - About 30 fields across four cards.
  - Jargon such as "Web address slug" and "Minimum responses before showing scores".
  - Status is buried.
  - _Fix:_ status and the next step at the top; tuck advanced items away.
- **Publishing a story is a long round trip**: filter, open, scroll past private feedback, approve each photo, excerpt, publish, back to the list. _Fix:_ "Next story ready to publish" after publishing, and "Approve all permitted photos".
- **Confirmations at the wrong level.**
  - Unpublishing a story asks for a reason but no confirm.
  - Rejecting a photo is one click with no undo hint.
  - Changing the web address breaks old links with only a hint.
  - Removing a feedback area hides its ratings.
  - The opening's "Publish now" goes live with no confirm, but Unpublish asks for one.
  - _Fix:_ confirm the address change and feedback-area removal, make reject reversible, and treat publish and unpublish the same.
- **Album wording contradicts itself.** It's a "thank-you that unlocks when guests review" and also "public: anyone can view it". It's also buried at the bottom of Public site. _Fix:_ say what the reward actually is now (adding photos), and give the album its own tab or anchor.
- **Each image card is heavy.**
  - Alt text, caption, credit, a numeric order and three switches per image.
  - Nothing shows until permission is ticked on each image, one by one.
  - _Fix:_ "I have permission for all of these" after upload, and drag to reorder.
- **The website field sits above the programme list.** _Fix:_ move it to an organisation settings page.
- **Change requests are hard to reach.** The dashboard banner says "open a programme's Responses tab" but doesn't link there, and there's no filter for open requests.

### P3

- Eight tabs scroll sideways on phones, hiding Appearance and Share kit. Merge Anonymous notes and Insights into "Feedback".
- The invitations table becomes a sideways scroll on phones, and "Ends …abc" is cryptic.
- Responses search needs a button press while the filters apply instantly.
- "Email everyone" (Interested) has no preview or "send a test to me", and doesn't say the list covers the whole organisation.
- Share kit opens with the logo settings before the stories. Put the stories first.
- The Privacy page banner about processing terms doesn't say whether anything is blocked.
- Internal wording leaks into the interface: "scrambled form", "Wording version", "The server rejects anything not found word for word".

---

## 3. Public visitors: retreat page, stories, album, updates

### P1

- **The page doesn't say what it is or who it's from until you scroll** (`RetreatLanding.tsx`, `.landing-top.with-album`).
  - It opens on a 62%-of-screen album card with the details card over it.
  - The `h1`, "From {organiser}" and the rating come after.
  - The details card's `h2` comes before the `h1`.
  - _Fix:_ title, organiser and rating first; album lower or smaller.
- **Stories are hard to reach from the retreat page.** Reviews now show in full (as requested), but nothing links to each story's own page, the immersive viewer. _Fix:_ link the review's date or title to its story page ("Open story").

### P2

- **Repetition and competing actions.**
  - Photos appear three times: album card, hero slideshow, review photos.
  - The rating appears twice ("5.0 from 2 guest reviews" and "· 2 rated").
  - The updates sign-up appears twice: the details-card pop-up, and the card lower down.
  - The details card's "Website" competes with the organiser's own call-to-action button.
  - _Fix:_ one rating, one sign-up entry, one main call to action.
- **No sign that reviewers really attended.** Avatar, first name, date and stars, but nothing that says they were invited as guests. "5.0" from two reviews is shown prominently. _Fix:_ a "Verified guest · Oct 2026" tag, and a small-sample note.
- **Failed hearts and helpful votes revert silently** on the retreat and story pages; the message is only shown on the album page. _Fix:_ show it beside the button.
- **The helpful count shows twice** ("2 people found this helpful" plus the badge "2"). _Fix:_ keep one.
- **The public album has no organiser branding**: only the Croot logo and "Back to the retreat", no organiser name, footer or privacy link. Keyboard focus isn't kept inside the full-screen viewer.
- **The organiser's retreats page is thin.**
  - No footer or privacy link.
  - The organiser name appears twice.
  - The sign-up card sits above the actual list.
  - _Fix:_ list first, then sign-up, then footer.
- **Layout bug risk.** `.landing-top.with-album` is defined several times with conflicting layouts (`styles.css` ~2814, 2837, 2843, 2891). Between roughly 860 and 1000px the details card may cover the album title _(unverified)_.

### P3

- Slideshow and story viewer pause buttons change their label *and* use `aria-pressed`. Use one. A tap on the story viewer both pauses and advances.
- Alt text is weak: "Photo shared by the guest" and "Retreat photo". The album cover is `alt=""`. Prompt for real descriptions.
- Duplicate CSS blocks should be consolidated.

---

## 4. Sign-in, account and admin

### P1

- **The password option is a dead end for most people** (`SignIn.tsx`; `/api/auth/providers` always says `password: true`). Code and Google accounts have no password, and there's no reset. _Fix:_ hide it behind "Organiser with a password?", or add reset.
- **Landing page promises organiser sign-up the server may not allow** (`Home.tsx` vs `ORG_SIGNUP_ENABLED=false`). _Fix:_ read the flag and show "Request access" when it's off. (Check what "Become an organiser" does in that case.)

### P2

- **Brand name is inconsistent.**
  - The logo wordmark is lowercase "croot"; everywhere else says "Croot".
  - Earlier direction was a capital C everywhere.
  - Share kit says "09F symbol and croot name".
  - _Fix:_ decide once, then update the SVGs and copy.
- **Admin console is one long page.**
  - "Tenants" vs "organisations".
  - Destructive actions without confirmation: Disable account, remove membership, approve.
  - Organisation delete uses `window.prompt`.
  - _Fix:_ tabs with pending counts, consistent naming, proper confirm dialogs.

### P3

- The sign-in intro is long and organiser-focused. "Send a new code" only changes the info line, and the rate limit (10 per 15 minutes) isn't explained. _Fix:_ shorter intro, "New code sent at 14:05", and a cooldown on the button.
- The landing page has five buttons that all go to `#get-started`. "On your own domain" is unexplained.

---

## Patterns behind the friction

1. **Hidden state.** Draft vs live, saved vs unsaved, published vs not, sent vs not: each is shown differently, if at all. A consistent status language (Live / Draft / Saved) and one status panel would remove most organiser confusion.
2. **Promises the code doesn't keep.** Approval of album photos, bookmarkable private links, "takes effect straight away", organiser sign-up. Align the copy with the behaviour, or the behaviour with the copy.
3. **Too many routes to the same thing.** Duplicate switches, duplicate sign-ups, duplicate ratings, photos in three places. One obvious place for each.
4. **Manual steps that software should do.** Emailing invitations, approving photos one by one, reordering by number, editing a sent review in several hops.
5. **Dead ends.** Link-unavailable, form-closed and password sign-in each need a way forward.

## Suggested order of work

1. **Get-live path:** a Go live banner and checklist, no Draft links, and a public page status panel. (Organiser P1s)
2. **Guest safety:** keep the note, a stable private link, and edit straight back into the review. (Guest P1s)
3. **Honest copy:** decide album moderation, unify the save model, and fix the "Saved" message.
4. **Retreat page hierarchy:** identity first, one rating, one sign-up, story links, a verified-guest tag.
5. **Email invitations from Croot.**
6. **Sign-in clean-up**, brand casing, and the admin console.
7. **Accessibility and mobile polish** (field hints, focus rings, the panel on phones, tab overflow).
