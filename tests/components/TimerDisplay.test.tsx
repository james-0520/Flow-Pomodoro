import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TimerDisplay from "../../components/TimerDisplay";

test("TimerDisplay renders FLOW mode with hour format and active animations", () => {
  const html = renderToStaticMarkup(
    TimerDisplay({
      seconds: 3661,
      label: "Focus",
      mode: "FLOW",
      isPaused: false,
    })
  );

  expect(html).toMatch(/01:01:01/);
  expect(html).toMatch(/text-sky-400/);
  expect(html).toMatch(/animate-pulse/);
  expect(html).toMatch(/animate-ping/);
});

test("TimerDisplay renders BREAK mode and paused state removes animation classes", () => {
  const html = renderToStaticMarkup(
    TimerDisplay({
      seconds: 75,
      label: "Break",
      mode: "BREAK",
      isPaused: true,
    })
  );

  expect(html).toMatch(/01:15/);
  expect(html).toMatch(/text-emerald-400/);
  expect(html).not.toMatch(/animate-pulse/);
  expect(html).not.toMatch(/animate-ping/);
});

test("TimerDisplay renders FLOW paused state without ping animation", () => {
  const html = renderToStaticMarkup(
    TimerDisplay({
      seconds: 30,
      label: "Flow Paused",
      mode: "FLOW",
      isPaused: true,
    })
  );

  expect(html).toMatch(/00:30/);
  expect(html).toMatch(/bg-sky-500/);
  expect(html).not.toMatch(/animate-ping/);
});

test("TimerDisplay renders BREAK active state with ping animation", () => {
  const html = renderToStaticMarkup(
    TimerDisplay({
      seconds: 30,
      label: "Break Active",
      mode: "BREAK",
      isPaused: false,
    })
  );

  expect(html).toMatch(/00:30/);
  expect(html).toMatch(/bg-emerald-500/);
  expect(html).toMatch(/animate-ping/);
});

test("TimerDisplay renders IDLE mode without background pulse block", () => {
  const html = renderToStaticMarkup(
    TimerDisplay({
      seconds: 65,
      label: "Idle",
      mode: "IDLE",
    })
  );

  expect(html).toMatch(/01:05/);
  expect(html).toMatch(/text-slate-400/);
  expect(html).not.toMatch(/absolute inset-0 opacity-10/);
});
