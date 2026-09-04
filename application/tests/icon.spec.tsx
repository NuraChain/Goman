// The icon pipeline's contract: lucide node data must come out as namespaced SVG geometry
// (the non-namespaced failure mode paints nothing), decorative by default, mirrored only
// for direction-implying names.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import Icon from '../src/icons/icon.tsx';
import { ICONS, MIRRORED } from '../src/icons/registry.ts';

describe('Icon', () => {
    it('renders lucide node data as namespaced SVG geometry', () => {
        const { container } = render(<Icon name="trending-up" />);
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
        const paths = svg?.querySelectorAll('path') ?? [];
        expect(paths.length).toBeGreaterThan(0);
        expect(paths[0]?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });

    it('is decorative: hidden from the tree, sized square, stroked not filled', () => {
        const { container } = render(<Icon name="search" size={24} />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
        expect(svg?.getAttribute('width')).toBe('24');
        expect(svg?.getAttribute('height')).toBe('24');
        expect(svg?.getAttribute('fill')).toBe('none');
        expect(svg?.getAttribute('stroke')).toBe('currentColor');
    });

    it('marks direction-implying icons for the CSS mirror, and only those', () => {
        const mirrored = render(<Icon name="chevron-right" />);
        expect(mirrored.container.querySelector('svg')?.classList.contains('icon-mirror')).toBe(true);
        mirrored.unmount();
        const still = render(<Icon name="trending-up" />);
        expect(still.container.querySelector('svg')?.classList.contains('icon-mirror')).toBe(false);
    });

    it('keeps caller classes alongside the mirror flag', () => {
        const { container } = render(<Icon name="arrow-left" className="text-brand" />);
        const svg = container.querySelector('svg');
        expect(svg?.classList.contains('text-brand')).toBe(true);
        expect(svg?.classList.contains('icon-mirror')).toBe(true);
    });

    it('every registry entry is renderable node data', () => {
        for (const name of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
            expect(Array.isArray(ICONS[name]), name).toBe(true);
            expect(ICONS[name].length, name).toBeGreaterThan(0);
        }
        for (const name of MIRRORED) {
            expect(name in ICONS).toBe(true);
        }
    });
});
