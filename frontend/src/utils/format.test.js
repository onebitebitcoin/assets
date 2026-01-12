import { formatKRW, formatDelta } from "./format";

it("formats KRW", () => {
  const value = formatKRW(10000);
  expect(value).toContain("₩");
});

it("formats delta with sign", () => {
  expect(formatDelta(5000)).toContain("+");
  expect(formatDelta(-5000)).toContain("-");
});
