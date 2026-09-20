import { useRef, useState } from 'react';

import { client, normalizeTag, tagNameOf, TAGS_PER_MARKET, type TagCount } from '../../api.ts';

import { useResource } from '../../hooks/use-resource.ts';
import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';

import { inputClass } from './variants.ts';

// The one place a tag list is WRITTEN. Used by the create form and by the post-deploy edit
// dialog, so the rules about what a tag is - how it normalises, when it is a duplicate, how
// many a market may carry - are answered identically in both.
//
// Completion comes from the tags markets already carry, most-used first, which is the whole
// defence against a vocabulary splintering into `football`, `foot-ball` and `footbal`. But
// the field never REFUSES a new tag: the first market about a subject has to be able to name
// it, and an autocomplete that only offers what exists can never grow.

/** How long after the last keystroke the suggestion query runs. Matches the browse box. */
const DEBOUNCE_MS = 250;

export default function TagField(props: {
    value: string[];
    onChange: (next: string[]) => void;

    /** The accessible name of the text input. */
    label: string;
    placeholder?: string;

    /** Written direction of the value; tags are written in the author's own language. */
    dir?: 'ltr' | 'rtl';
})
{
    const { t } = useLocale();

    const [typed, setTyped] = useState('');
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const full = props.value.length >= TAGS_PER_MARKET;

    // The slugs already on the market, so a suggestion cannot offer what is already chosen.
    const chosen = new Set(props.value.map(normalizeTag));

    const suggestions = useResource(
        () => (open ? `q:${ query }` : false),
        () => client.tags.list({ query: { q: query === '' ? undefined : query, limit: 8 } })
    );

    const offered = (suggestions.data() ?? []).filter((tag: TagCount) => !chosen.has(tag.slug));

    const add = (raw: string): void =>
    {
        const name = tagNameOf(raw);
        // Silent on a duplicate rather than complaining: re-typing a tag the market already
        // has is not a mistake anyone needs told about, it is just already done.
        if (name === '' || normalizeTag(name) === '' || chosen.has(normalizeTag(name)) || full)
        {
            setTyped('');
            return;
        }
        props.onChange([...props.value, name]);
        setTyped('');
        setQuery('');
    };

    const remove = (at: number): void =>
    {
        props.onChange(props.value.filter((_, index) => index !== at));
    };

    const onType = (next: string): void =>
    {
        // A comma ENDS a tag. Pasting `football, iran, league` should be three tags, which
        // is how every list anyone has ever written one looks.
        if (next.includes(','))
        {
            const parts = next.split(',');
            const last = parts.pop() ?? '';
            let list = props.value;
            for (const part of parts)
            {
                const name = tagNameOf(part);
                const slug = normalizeTag(name);
                if (
                    slug !== '' &&
                    !list.some((entry) => normalizeTag(entry) === slug) &&
                    list.length < TAGS_PER_MARKET
                )
                {
                    list = [...list, name];
                }
            }
            if (list !== props.value)
            {
                props.onChange(list);
            }
            setTyped(last);
            next = last;
        }
        else
        {
            setTyped(next);
        }

        setOpen(true);
        if (timer.current !== null)
        {
            clearTimeout(timer.current);
        }
        const term = normalizeTag(next);
        timer.current = setTimeout(() => setQuery(term), DEBOUNCE_MS);
    };

    return (
        <div>
            {props.value.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {props.value.map((tag, at) => (
                        <span
                            key={normalizeTag(tag)}
                            className="flex h-8 items-center gap-1 rounded-full bg-overlay ps-3 pe-1 text-[13px] font-semibold"
                        >
                            <bdi>{tag}</bdi>
                            <button
                                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-200 hover:bg-no-soft hover:text-no"
                                type="button"
                                aria-label={`${ t('tags.remove') } ${ tag }`}
                                onClick={() => remove(at)}
                            >
                                <Icon name="x" size={13} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="relative">
                <input
                    className={inputClass('md', false)}
                    type="text"
                    value={typed}
                    placeholder={full ? t('tags.full') : (props.placeholder ?? t('tags.placeholder'))}
                    disabled={full}
                    dir={props.dir}
                    aria-label={props.label}
                    onChange={(event) => onType(event.target.value)}
                    onFocus={() => setOpen(true)}
                    // The list has to survive the click that picks from it, so it closes on
                    // the next frame rather than on the blur itself.
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    onKeyDown={(event) =>
                    {
                        if (event.key === 'Enter')
                        {
                            event.preventDefault();
                            add(typed);
                        }
                        // Backspace on an EMPTY field takes the last tag off - the gesture
                        // every tag field in every app has, and the reason the chips are
                        // before the input rather than after it.
                        if (event.key === 'Backspace' && typed === '' && props.value.length > 0)
                        {
                            remove(props.value.length - 1);
                        }
                    }}
                />

                {open && offered.length > 0 && (
                    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-card border border-line bg-overlay shadow-2xl">
                        {offered.map((tag) => (
                            <button
                                key={tag.slug}
                                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-start text-[14px] transition-colors duration-200 hover:bg-raised"
                                type="button"
                                // `mousedown`, not `click`: the input's blur fires first and
                                // would close the list out from under the pointer.
                                onMouseDown={(event) =>
                                {
                                    event.preventDefault();
                                    add(tag.name);
                                }}
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    <bdi>{tag.name}</bdi>
                                </span>
                                <span className="nums latin-nums shrink-0 text-[12px] text-faint" dir="ltr">
                                    {tag.count}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <p className="mt-1 text-[12px] text-faint">{t('tags.hint')}</p>
        </div>
    );
}
