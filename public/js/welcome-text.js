// Made by scripts/welcome.mjs from WELCOME.md. Don't edit it: rebuild.

/**
 * @typedef {{ text: string, bold?: true, italic?: true, email?: true }} Span
 * @typedef {{ kind: "heading" | "paragraph", spans: Span[] } | { kind: "list", items: Span[][] }} Block
 */

/** @type {Block[]} */
export const WELCOME = [
  {
    "kind": "heading",
    "spans": [
      {
        "text": "Welcome to NōtoNawa, your secure tie planning and tracking journal."
      }
    ]
  },
  {
    "kind": "paragraph",
    "spans": [
      {
        "text": "Here's your quick and dirty guide:"
      }
    ]
  },
  {
    "kind": "list",
    "items": [
      [
        {
          "text": "Ties",
          "bold": true
        },
        {
          "text": " are your scenes and your labbing sessions. Log what you tied, who you tied with (or who took photos), where it happened, rate how it went, and make any notes you want to remember (e.g. what could have gone better)."
        }
      ],
      [
        {
          "text": "Plans",
          "bold": true
        },
        {
          "text": " represent ties or elements you've been noodling on, and allows you to link them to Ties to keep track of iterations and/or attempts. Quickly add an idea to rough out later, keep detailed notes on harness steps, or plan out a suspension sequence."
        }
      ],
      [
        {
          "text": "People",
          "bold": true
        },
        {
          "text": " are your tying partners, photographers, spotters, and educators you learn from. Add them once and pick them from a list when logging ties or workshops. You can quick-add new people from the New Tie form, and keep track of additional information about them in the People view. You can archive a person you don't expect to log again to remove them from the list when logging ties."
        }
      ],
      [
        {
          "text": "Locations",
          "bold": true
        },
        {
          "text": " are where you tie. They work pretty much like People do but you also can save a link to google/apple maps or coordinates. This helps you keep track of outdoor rope bomb locations and lets you plot your ties on a super cool map (if that's your kink)."
        }
      ],
      [
        {
          "text": "Tags",
          "bold": true
        },
        {
          "text": " help you organize and find ties and plans, and filter the nerdy charts and stuff. Use those to track what harnesses you used (e.g. 'hug harness') or find ties where something happened (e.g. 'vasovagal') or whatever you want."
        }
      ],
      [
        {
          "text": "Notes and photos are encrypted.",
          "bold": true
        },
        {
          "text": " Your device encrypts them before sending them to our server, and decrypts them when you view them. We can't see them, and neither can anyone who gets hold of our servers without your passkeys or recovery code. Read our Privacy Policy for more information."
        }
      ],
      [
        {
          "text": "Speaking of your recovery code,",
          "bold": true
        },
        {
          "text": " don't lose that shit. If you lose all your passkeys and your recovery code, your encrypted notes and photos are "
        },
        {
          "text": "gone forever",
          "italic": true
        },
        {
          "text": ". Save your recovery code somewhere safe, add a second passkey (like on another device) as a backup, and consider setting a recovery email so we can at least help you get the rest of your data back."
        }
      ],
      [
        {
          "text": "Install the app",
          "bold": true
        },
        {
          "text": " via the settings in your browser to have it appear on your phone homescreen with other apps."
        }
      ],
      [
        {
          "text": "We are constantly iterating",
          "bold": true
        },
        {
          "text": " and adding new features. If you have questions, ideas, or run into trouble, we'd love to hear from you. Use the \"Bug and feedback\" button in the menu or use our contact email below to send us your thoughts, hopes, and dreams."
        }
      ]
    ]
  },
  {
    "kind": "paragraph",
    "spans": [
      {
        "text": "Need help?",
        "bold": true
      },
      {
        "text": " Email us at "
      },
      {
        "text": "contact@notonawa.app",
        "email": true
      }
    ]
  }
];
