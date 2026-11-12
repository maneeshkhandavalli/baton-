import { createCn } from "cn/config"

/**
 * Class-name merging that knows Baton's custom theme steps (app/globals.css), so that e.g.
 * `text-caption` is merged as a font size and never drops a text colour such as
 * `text-primary-foreground`. Always import `cn` from here, not from "cn".
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "caption", "md"] }],
      shadow: [{ shadow: ["soft", "raised", "overlay"] }],
    },
  },
})
