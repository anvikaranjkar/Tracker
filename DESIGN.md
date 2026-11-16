# Show Up design notes

I reviewed the product screens and demos for Hevy, Structured and HabitShare. I also read an independent analysis of interface patterns people associate with AI-generated websites. The app uses an off-white page, dark ink, cobalt actions and the structure of a sports fixture. Instrument Sans carries the interface and IBM Plex Mono identifies dates, quantities and signatures.

| Screen | Observed pattern | Design decision |
| --- | --- | --- |
| Today | Hevy puts prior amounts next to the current input and offers a way to reuse them. | Keep the fastest log action beside its goal. Open the relevant unit, offer common amounts and optionally remember a favourite. Keep the friend’s progress beside the user’s own list on desktop. [Hevy logging screens](https://www.hevyapp.com/features/track-exercises/) |
| Calendar | Structured groups tasks into a single timeline and offers week and month views. | Start in week view with a day agenda. Use the grid to scan dates and the agenda for titles, status, logs and editing. Tags and visible counts support scanning at narrow sizes. [Structured product demo](https://structured.app/) |
| Match sheet | HabitShare gives friends visibility into selected habits and keeps private ones out of their view. | Show exactly what both members agree to on two sides of one sheet. Keep personal events and private notes out of the partner’s account. Use a dated stamp for each signature and make the editable draft visibly distinct. [HabitShare product screens](https://habitshareapp.com/) |

Three defaults were removed from the design:

- Gradient text, purple glows and unrelated decoration. Cobalt marks the next action or selected state. Thin lane lines support the fixture-sheet direction. [Vibecoded Design Tells critique](https://github.com/JCarterJohnson/vibecoded-design-tells/blob/main/unslop-ai-ui/DATA_AND_GRAPHS.md)
- A uniform grid of rounded cards. Daily goals use ruled rows, the calendar uses a true seven-day grid, and the agreement uses a two-sided match sheet.
- A task screen dominated by marketing copy and filler badges. Today starts with the date and a single next move. Pact status, due labels and demo labels describe real states.

Controls have visible focus, text accompanies status colour, the sign action has a keyboard-accessible confirmation, and motion respects reduced-motion settings. The browser check covers overflow and automated axe checks at phone and desktop widths. The build environment prevented screenshot review. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
