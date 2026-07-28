import { test, expect } from "@playwright/test";

// Regression test for a ResizeObserver feedback loop in the numbered-seat
// public event page: SeatPickerCanvas observes its *parent* element's width
// and mirrors it onto an internal <canvas>. The parent was a bare grid item
// in a `grid-cols-[1fr_300px]` layout with no `min-w-0` — without it, a CSS
// Grid track's min-content sizing lets a wide child (the canvas) push the
// track wider, which the observer picks up and mirrors again, growing the
// canvas without bound. Visually this looked like the seat map (and the
// selection ring) continuously drifting to the right.
test("Seat map container width stays stable over time (no ResizeObserver feedback loop)", async ({ page }) => {
  await page.goto("/o/demo-org/e/funcion-especial-demo-numerado");
  await expect(page.getByTestId("seat-picker")).toBeVisible({ timeout: 15_000 });

  const widths: number[] = [];
  for (let i = 0; i < 6; i++) {
    const box = await page.getByTestId("seat-picker").boundingBox();
    if (box) widths.push(box.width);
    await page.waitForTimeout(300);
  }

  const first = widths[0];
  for (const w of widths) {
    expect(Math.abs(w - first)).toBeLessThan(2);
  }
});
