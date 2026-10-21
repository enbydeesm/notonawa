// Made by scripts/releases.mjs from RELEASES.md. Don't edit it: rebuild.

/** The app's version: the newest release. */
export const APP_VERSION = "2026.10.20.006";

/** @type {{ version: string, notes: string[] }[]} newest first */
export const RELEASES = [
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
