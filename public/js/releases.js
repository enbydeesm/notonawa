// Made by scripts/releases.mjs from VERSION and RELEASES.md. Don't edit it: rebuild.

/** The app's version: when it was deployed (scripts/deploy.mjs). */
export const APP_VERSION = "2026.10.28.2218";

/**
 * Newest first. A note is its words, or its words and sub-bullets; intro
 * is the paragraphs before a release's notes, if it has any.
 * @type {{ version: string, intro?: string[], notes: (string | { text: string, sub: string[] })[] }[]}
 */
export const RELEASES = [
  {
    "version": "2026.10.28.001",
    "intro": [
      "Share with other people who use NōtoNawa!"
    ],
    "notes": [
      "Everything you share is encrypted on your device first, and the key is only in the link, so NotoNawa can't read it.",
      "The 'Your data' menu has \"Shared by me\": every share invite that hasn't ended, when it ends and how many times it's been opened, with Show code and Revoke. Revoking deletes it at once, photos too.",
      "Every share has a QR code and a Copy link button. Scan the code with a phone's camera to open it.",
      {
        "text": "Sharing profiles:",
        "sub": [
          "Tap Share on your 'Me' profile to make an invite. Choose what goes in it, how long the invite lasts, whether one person or anyone with the link can use it, and whether you'd like to connect your accounts.",
          "People now have two notes fields. \"Private notes\" is just for you and is never shared. On your own profile, \"About me\" is the part you can choose to share. On someone else's card, \"About them, shared by them\" shows what they shared, and only their next share changes it. Use this field to share about your modifications in rope, your likes and dislikes, etc.",
          "Opening a profile share prompts to add them as a new person, or add it to someone already in your People. For an existing person you choose, field by field, whether to keep your data or take theirs. Your private notes about them stay as they are."
        ]
      },
      {
        "text": "Connecting accounts:",
        "sub": [
          "Tick it on a profile invite to link your account with whoever accepts it. They have to consent on their side too. When someone accepts your invite, a banner lets you add them to a Person or make a new Person. A linked profile shows a link icon.",
          "Connecting lets NotoNawa's server see that the two accounts know each other, but never what's in either journal. It opens the way for later features with that person, like sending things inside the app and live plan sharing and messaging.",
          "Remove a connection at any time from Your data > Connections. It's also removed if either of you deletes your account, and gives you the option to delete your shared 'About me' from their journals."
        ]
      },
      {
        "text": "Sharing ties, plans, and workshops:",
        "sub": [
          "Tap Share in its dialog and tick what to include, down to each field, drawings and poses, and photos and videos. The other person gets a copy. Changing yours later doesn't change theirs.",
          "Opening a share link for a tie, plan or workshop: \"Who is this?\" asks who each person is in your journal (Me, one of your people, or a new person), and the same for the location and plans. Then \"Add to my journal\" adds it with its visuals. If it looks like one you already have, you can still add another copy."
        ]
      },
      {
        "text": "Various UI updates:",
        "sub": [
          "Edit dialogs now have their heading row icons: delete, archive or restore, share and close. Save changes stays muted until you've changed something, and closing with unsaved changes asks before discarding them.",
          "The Ties, Plans and Education searches show just the keyword box, with the rest under \"More options\". The search cards and the Analytics filters take up a little less room.",
          "Ties has an \"Add a Tie\" card at the top, like the other pages, and the new tie dialog is now called \"Add a tie\".",
          "Pulling down on the page no longer reloads it. When an update is waiting, the app loads it as you unlock.",
          "Logo and icon updates"
        ]
      }
    ]
  },
  {
    "version": "2026.10.26.001",
    "intro": [
      "Lots of Model Poser updates!"
    ],
    "notes": [
      "Drag an arm or a leg to move it. Put your finger on a hand, forearm, foot or shin and drag, and the shoulder and elbow (or hip and knee) bend to follow; drag an upper arm or thigh to swing it from the shoulder or hip. Joints never bend further than a body can. Dragging anywhere else still turns the view.",
      "Tap the number beside any slider to type an exact value. Numbers outside the slider's range are kept to its nearest end. Tap ▲ and ▼ beside its number to nudge it by one.",
      "Save your own body and arms positions: choose \"Save this body as a preset…\" or \"Save these arms as a preset…\" in the Body… and Arms… menus. They're listed under \"My presets\" in every pose, and \"Manage my presets…\" renames and deletes them. Their names are encrypted; the positions aren't, like poses.",
      "Bamboo: set its length (90 to 215 cm) and how far in from each end its two lines hang. The lines holding up the ring and bamboo now look like jute rope.",
      "Pencil: tap the pencil beside Rope to draw over the view, in the same colors and widths as ropes, with its own eraser. The marks go into the picture \"Add to visuals\" and download make, but aren't saved with the pose, and they hide when you turn the view.",
      {
        "text": "Tap a rope in Rope mode to choose it.",
        "sub": [
          "A rope that goes from the body over the ring or bamboo and back is a see-saw: raise one end and the other drops to keep its length (untick See-saw if yours is tied off).",
          "\"Cinch from here\", then tapping another upline, a rope or the body, ties a cinch: shorten it to draw the uplines together, and with \"Move the body\" ticked the body is drawn in with them.",
          "On a bamboo, \"Move along bamboo\" slides where an upline is tied."
        ]
      },
      "Uplines now hang straight from the body to the ring or bamboo, and are easier to tap. Finish rope is outlined while a rope is being laid, as a reminder to finish it."
    ]
  },
  {
    "version": "2026.10.23.001",
    "notes": [
      "Poses: pose a 3D figure. Choose a position for the body (standing, kneeling, face down…) and for the arms (boxtie, tengu, tenshi…) separately, or tap a body part and move it with the sliders. Drag to turn the view, drag with two fingers to pan, and pinch to zoom.",
      "In Rope, tap the body point by point to lay a rope, and add a ring or bamboo for uplines, or a hashira to tie to. Undo and Redo go back over everything you've done.",
      "\"Add to visuals\" in the poser saves a picture of the pose as a photo attached to the tie, plan, or workshop. Caption, duplicate, copy and reorder poses like drawings, and line several up to show a sequence. You can also download a photo to your device.",
      "Poses aren't encrypted (their captions are). They're in your export, and come back when you import it.",
      "Visuals: photos and videos, drawings and poses now share one section on ties, plans and workshops, in whatever order you drag them into. Tap + to add a visual from a photo or video, a drawing, or the model poser. Each is outlined in its own color, and you can swipe through them in their details."
    ]
  },
  {
    "version": "2026.10.22.001",
    "notes": [
      "Drawings: tap + on \"Drawings\", under Photos and videos on a tie, plan or workshop, to draw with your finger, a pen or a mouse, in eight colors and three widths. The eraser removes a whole line, and Undo and Redo go back over everything you've done. Caption a drawing like a photo, edit it again later, or drag drawings into order.",
      "Duplicate a drawing to try a variation: the copy is edited on its own. Copy to… puts a copy on another tie, plan or workshop.",
      "Drawings aren't encrypted (their captions are), so don't write names in one. They're in your export, with a picture of each.",
      "When viewing in a browser, a banner will now appear with an install button or instructions"
    ]
  },
  {
    "version": "2026.10.20.006",
    "notes": [
      "Education: a new tab (the graduation cap) for the workshops you attend and teach. Tap + on \"Add a Workshop\" to log one: its title, dates, location, educators, participants, how many attended, a rating, a description, notes, photos and videos, an album link and tags.",
      "Educators are picked from the people marked Educator in People. Mark your own profile as an educator to log the workshops you teach: they show under Taught, and the rest under Attended.",
      "Summary adds up what you've attended and taught: workshops, days, educators, locations, partners, attendees and ratings, with your most frequent educators and tags.",
      "The search on Education finds workshops by keyword, people, educators, locations, dates and tags, and narrows all three tabs.",
      "Workshop descriptions, notes and album links are encrypted like your other notes, and workshops are included when you export and import your data."
    ]
  },
  {
    "version": "2026.10.20.005",
    "notes": [
      "The app can be installed from the browser and appear on homescreens with other apps",
      "Photos: drag a photo to put it in order, with a mouse or with your finger (hold it still for a moment first, so swiping still scrolls). Move earlier and later are still in the photo viewer.",
      "Videos: add clips of up to 3 minutes to ties and plans, with the same + as photos (up to 5 a tie or plan). Each one is made smaller (480p) on your device, with its location and device details removed, and encrypted before it's uploaded, like your photos.",
      "Videos play in the viewer, with buttons to slow them down to as little as a quarter speed, or speed them up to double."
    ]
  },
  {
    "version": "2026.10.20.004",
    "notes": [
      "Analytics: the period, role and filters stay at the top of the screen as you scroll, and the numbers have a card of their own.",
      "Analytics has a map: a pin for each location your ties were at, if it has coordinates. Zoom with + and −, drag to move around, and tap a pin to see its ties. Pins close together join up until you zoom in.",
      "Analytics: Locations now comes before Days of the week."
    ]
  },
  {
    "version": "2026.10.20.003",
    "notes": [
      "Locations: tap + on \"Add a Location\" to add one in a pop-up form. Tap a name to edit it; Archive and Delete are there too.",
      "Locations can have a city, state or province and country, shown on their cards. Searching locations finds those too.",
      "Plans, People and Locations: the + now comes first on their \"Add\" cards.",
      "People: \"Educator\" now sits beside the Name, and \"This is me\" beside the form's title. Pronouns and social names no longer start with a capital letter as you type them."
    ]
  },
  {
    "version": "2026.10.20.002",
    "notes": [
      "People: tap + on \"Add a Person\" to add someone in a pop-up form. Tap a name to see their details; Archive and Delete are there too.",
      "People can have \"Based in\", social and scene names (FetLife, Instagram and more), and an \"Educator\" tick. Like notes, these are encrypted so only you can read them.",
      "People's cards show their pronouns, usual role, where they're based and their other names, with a cap for educators.",
      "Searching for people, on People, the tie form and the Ties search, finds their social and scene names too."
    ]
  },
  {
    "version": "2026.10.20.001",
    "notes": [
      "A welcome with a quick guide to the app. It shows each time you unlock until you tick \"Don't show this again\".",
      "\"Bug and feedback\" in the menu: tell us about a bug or an idea from inside the app, or email us to attach a screenshot.",
      "Plans: tap + on \"Add a Plan\" to add one in a pop-up form, like logging a tie. Edit opens the same form.",
      "Plans can be searched by keyword, plan type, tie type and tags.",
      "Each plan shows how many ties it's on and their average rating, and its form lists those ties: tap one to open it."
    ]
  },
  {
    "version": "2026.10.19.001",
    "notes": [
      "Every tie now has a type. Ties previously logged without one are now 'hashira': change any that should be something else.",
      "Plans can have a tie type and tags, like ties.",
      "Ties and plans can link to a photo album (Google Photos, iCloud or anywhere else). The link is encrypted, like your notes.",
      "Plan difficulty is chosen with rope hanks, and your default location stays at the top of Locations.",
      "\"What's new\" in the menu shows these notes again."
    ]
  }
];
