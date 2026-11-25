# Shared quiz library: one-time setup

This turns on the **Saved quizzes** card in the quiz engine: one shared
password, one shared list of quizzes that every teacher can save to and open
from any computer. Until this is done the card is hidden and the engine works
exactly as before.

It uses a free [Supabase](https://supabase.com) project as the database. The
whole setup takes about 10 minutes and you only do it once.

## What is stored, and who can see it

- Each saved quiz is a **name**, an optional **author name**, and its **quiz
  code**. No pupil data, no marks, no personal details beyond a teacher
  typing their own name.
- Everyone who has the shared password can see, open, update and hide **every**
  saved quiz. There are no separate accounts, so the author name is only a
  label, not a lock.
- "Delete" only hides a quiz. Nothing is ever destroyed by the app, so a
  mistake can be undone (see "Undo a delete" below).

## Steps

1. **Create the project.** Sign up at supabase.com, choose **New project**,
   name it (for example `quiz-engine`), pick a nearby region (for the UK,
   London), and set a database password. Save that password somewhere safe;
   the quiz engine never uses it.

2. **Stop strangers signing up (important).** Go to **Authentication** then
   **Sign In / Providers** (in some versions **Providers** or **Settings**)
   and switch **off** "Allow new users to sign up". Leave the Email provider
   itself on.

3. **Create the one shared login.** Go to **Authentication** then **Users**
   then **Add user** then **Create new user**.
   - Email: anything in email format, for example `library@yourschool.test`.
     It does not need to be a real mailbox.
   - Password: choose a strong passphrase. This is the password every teacher
     will type into the quiz engine.
   - Tick **Auto Confirm User**.

4. **Create the table.** Open `supabase_setup.sql` from this folder. Replace
   `REPLACE_WITH_SHARED_EMAIL` (one place) with the email from step 3, keeping
   the quotes. Then in Supabase go to **SQL Editor** then **New query**, paste
   the whole file and press **Run**. It should finish with "Success".

5. **Copy three values** for the quiz engine:
   - **Project URL** and the **anon / public key** (Project Settings, then
     **API**, or **API Keys**). The anon key is meant to be public, because the
     database refuses to talk to anyone who has not signed in as the library
     user.
   - The **shared email** from step 3.
   - **Never** share the `service_role` key or the library password in a
     message or commit.

6. **Connect the quiz engine.** In `QuizEngine.jsx` fill in `LIBRARY_CONFIG`
   (near the top of the "shared online quiz library" section):

   ```js
   const LIBRARY_CONFIG = {
     url: "https://YOUR-PROJECT.supabase.co",
     anonKey: "YOUR-ANON-KEY",
     email: "library@yourschool.test",
   };
   ```

   Then rebuild (`cd tools && node build.js`), commit and push as usual. The
   **Saved quizzes** card appears for everyone, asking for the library password.

## Short codes

The same setup also switches on **short codes**: a 7-character code (for
example `GMD9K8B`) for any quiz, short enough to print on the sheet or read out.
Re-run `supabase_setup.sql` if you set the library up before short codes
existed (it is safe to run again).

- **Make short code** (in the *Quiz code* card, after signing in with the
  library password) gives the open quiz a code and a short link
  (`…/quiz_engine.html?code=GMD9K8B`). The code is also printed in the corner
  of the worksheet.
- **Anyone** can open a short code without a password: type it into the
  "Paste a quiz code or link" box, or use the short link. Codes can be looked
  up one at a time but not browsed.
- **Make follow-up quiz** keeps the same question types, gives new numbers and
  its own short code, ready to give in class next lesson.
- Only the quiz code is stored (question types and seeds), never pupil data.

## Day to day

- Teachers type the shared password once per computer. The browser remembers
  them until they press **Sign out of library**. On a shared school computer,
  sign out when you finish.
- **Save** stores the quiz that is open right now under a name. **Open** loads
  it back, exactly as it was (question order and regenerated numbers included).
  **Update** overwrites a saved quiz with the one that is open. **Delete**
  hides it for everyone.

## Changing the password

In Supabase: **Authentication**, **Users**, the library user, **Send password
recovery** or **Update user** and set a new password. Everyone is asked to sign
in again with the new one. Do this whenever someone who knew it leaves.

## Undo a delete

In Supabase: **Table Editor**, table `quizzes`. Find the row and clear its
`deleted_at` cell (set it back to empty / NULL). It reappears in the library.

## If something stops working

- *"That password isn't right."* The password was changed in Supabase, or was
  typed wrongly.
- *"Your library sign-in has expired."* Just sign in again.
- Card missing entirely: `LIBRARY_CONFIG` is empty, or the page is an old
  cached copy (hard refresh with Cmd/Ctrl+Shift+R).
- Free Supabase projects **pause after a week of no use**. If the card shows
  errors after a long holiday, open the project in Supabase and press
  **Restore**.
