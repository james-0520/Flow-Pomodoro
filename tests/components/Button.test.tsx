import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Button from "../../components/Button";

test("Button uses primary variant by default and keeps children", () => {
  let clicked = false;
  const element = Button({
    onClick: () => {
      clicked = true;
    },
    children: "Start",
  });

  expect(typeof element.props.onClick).toBe("function");
  element.props.onClick();
  expect(clicked).toBe(true);
  expect(element.props.className).toMatch(/bg-sky-500/);

  const html = renderToStaticMarkup(element);
  expect(html).toMatch(/Start/);
});

test("Button applies variant styles, disabled state, and title", () => {
  const variants = [
    { variant: "secondary" as const, classPattern: /bg-slate-700/ },
    { variant: "danger" as const, classPattern: /bg-rose-500/ },
    { variant: "ghost" as const, classPattern: /bg-transparent/ },
  ];

  for (const item of variants) {
    const element = Button({
      onClick: () => {},
      children: item.variant,
      variant: item.variant,
      disabled: true,
      title: `title-${item.variant}`,
      className: "extra-class",
    });

    expect(element.props.className).toMatch(item.classPattern);
    expect(element.props.className).toMatch(/extra-class/);
    expect(element.props.disabled).toBe(true);
    expect(element.props.title).toBe(`title-${item.variant}`);
  }
});
