import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIAgentPanel } from "@/components/board/AIAgentPanel";

describe("AIAgentPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders closed by default and opens on AI click", async () => {
    const user = userEvent.setup();
    render(<AIAgentPanel boardId="b1" userId="u1" />);
    expect(screen.queryByText("AI Agent")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AI" }));
    expect(screen.getByText("AI Agent")).toBeInTheDocument();
  });

  it("renders all suggested prompts and clicking a chip auto-submits command", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ summary: "Done" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<AIAgentPanel boardId="b1" userId="u1" />);
    await user.click(screen.getByRole("button", { name: "AI" }));

    const chipText = "Add a yellow sticky note that says User Research";
    expect(screen.getByText("Create a SWOT analysis template with four quadrants")).toBeInTheDocument();
    expect(screen.getByText(chipText)).toBeInTheDocument();
    expect(screen.getByText("Change all sticky notes to green")).toBeInTheDocument();
    expect(screen.getByText("Space these elements evenly")).toBeInTheDocument();
    expect(screen.getByText("Arrange in a grid")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: chipText }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/ai/command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ command: chipText, boardId: "b1", userId: "u1" }),
      }),
    );
  });

  it("does nothing when submitting empty input", async () => {
    const user = userEvent.setup();
    render(<AIAgentPanel boardId="b1" userId="u1" />);
    await user.click(screen.getByRole("button", { name: "AI" }));
    const input = screen.getByPlaceholderText("Type an AI command...");
    await user.type(input, "{enter}");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows executing state, disables input, and hides chips", async () => {
    const user = userEvent.setup();
    let resolveFetch: ((value: Response) => void) | null = null;
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<AIAgentPanel boardId="b1" userId="u1" />);
    await user.click(screen.getByRole("button", { name: "AI" }));
    const input = screen.getByPlaceholderText("Type an AI command...");
    await user.type(input, "Create a SWOT analysis{enter}");

    expect(screen.getByText("AI is working...")).toBeInTheDocument();
    expect(screen.queryByText("Suggested Prompts:")).not.toBeInTheDocument();
    expect(input).toBeDisabled();

    await act(async () => {
      resolveFetch?.(
        new Response(JSON.stringify({ summary: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
  });

  it("shows success summary then resets after 3 seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ summary: "Created template." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AIAgentPanel boardId="b1" userId="u1" />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    const input = screen.getByPlaceholderText("Type an AI command...");
    fireEvent.change(input, { target: { value: "Create a SWOT analysis" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Created template.")).toBeInTheDocument();
    expect(screen.queryByText("Suggested Prompts:")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Suggested Prompts:")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type an AI command...")).toHaveValue("");
  });

  it("shows error in red and re-enables input without auto-reset", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "AI command failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AIAgentPanel boardId="b1" userId="u1" />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    const input = screen.getByPlaceholderText("Type an AI command...");
    fireEvent.change(input, { target: { value: "Do thing" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const errorText = screen.getByText("AI command failed");
    expect(errorText).toHaveClass("text-red-600");
    expect(input).not.toBeDisabled();
    expect(screen.getByText("AI command failed")).toBeInTheDocument();
  });
});
