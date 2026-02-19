import { render, screen } from "@testing-library/react";
import App from "./App.jsx";

test("renders main header and tabs", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: /GraphBin-Viz/i })
  ).toBeInTheDocument();

  expect(screen.getByRole("tab", { name: /Output \+ Plots/i })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Interactive View/i })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Contig Flow/i })).toBeInTheDocument();
});

test("includes isolated contig filter", () => {
  render(<App />);
  expect(screen.getByLabelText(/Hide isolated contigs/i)).toBeInTheDocument();
});
