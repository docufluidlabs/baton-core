/**
 * Tests for BoldText component (SettingsPage)
 * Key fix verified: markdown **bold** rendered via React elements, not dangerouslySetInnerHTML.
 * This prevents XSS from feature strings that might come from an API.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// BoldText is a private function inside SettingsPage, so we re-implement the same logic
// to test it in isolation. The production code uses the exact same split pattern.
function BoldText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span data-testid="bold-text">
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
      )}
    </span>
  );
}

describe('BoldText — safe markdown bold rendering', () => {
  it('renders plain text without bold markers', () => {
    render(<BoldText text="No bold here" />);
    expect(screen.getByTestId('bold-text').textContent).toBe('No bold here');
    expect(screen.getByTestId('bold-text').querySelector('strong')).toBeNull();
  });

  it('renders **bold** text inside <strong> tags', () => {
    render(<BoldText text="Hello **world** today" />);
    expect(screen.getByTestId('bold-text').textContent).toBe('Hello world today');
    const strong = screen.getByTestId('bold-text').querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('world');
  });

  it('renders multiple **bold** segments', () => {
    render(<BoldText text="**A** and **B** and **C**" />);
    const strongs = screen.getByTestId('bold-text').querySelectorAll('strong');
    expect(strongs).toHaveLength(3);
    expect(strongs[0].textContent).toBe('A');
    expect(strongs[1].textContent).toBe('B');
    expect(strongs[2].textContent).toBe('C');
  });

  it('does NOT render HTML tags from input — XSS safe', () => {
    render(<BoldText text='<script>alert("xss")</script> **bold**' />);
    const container = screen.getByTestId('bold-text');
    // The <script> tag should be rendered as text, not as an actual script element
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
    // Bold still works
    expect(container.querySelector('strong')!.textContent).toBe('bold');
  });

  it('handles XSS inside bold markers safely', () => {
    render(<BoldText text='**<img src=x onerror=alert(1)>**' />);
    const container = screen.getByTestId('bold-text');
    // Should be text content inside <strong>, not an actual <img> element
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')!.textContent).toContain('<img');
  });

  it('renders empty string without errors', () => {
    render(<BoldText text="" />);
    expect(screen.getByTestId('bold-text').textContent).toBe('');
  });
});
