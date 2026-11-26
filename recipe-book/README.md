# Recipe book

One standard, printable page per recipe: title, who wrote it, quick facts, ingredients on the
left, numbered steps on the right, notes, space for handwriting, and a footer with the link
(and a QR code) to the original page.

## Add a recipe

1. Copy `recipes/_template.md` to `recipes/your-recipe-name.md` and fill it in. A recipe page
   copied out of Notion in the same shape (bullets for the facts, then Ingredients, Steps,
   Notes) works as is. Files starting with `_` are ignored.
2. Run `npm install` once, then `node build.js`.
3. Print `out/your-recipe-name.pdf`, or `out/recipe-book.pdf` for everything, at 100% scale
   on US Letter.

Or ask Claude: "add this recipe to the recipe book" with a link, a Notion page, or pasted text.

## Rules for the recipe text

- Ingredients are copied exactly: same items, same amounts, same order.
- Steps may be reworded for clarity and consistency, but every action, amount, time,
  temperature, and doneness cue stays. The dish must come out the same.
- `Author` and `Source` are required. The build stops if either is missing.
- Nothing is typed from memory. If the original page cannot be read, the recipe waits.

## Layout

The build keeps a recipe on one page by stepping the type down from 11.5pt to no smaller than
9.25pt. A recipe that still does not fit goes to two pages at 10.5pt. `1/2` is printed as `½`;
that is the only change the build makes to the text. The look lives in `recipe.css`.
