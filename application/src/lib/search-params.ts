// `useSearchParams` over the azeroth router.
//
// The app reads the query string as `URLSearchParams` in six places - repeated keys, `.get`
// with a default, a comma-joined tag list - and azeroth hands it a `Record<string, string |
// string[]>` instead. Converting between them once here is a fraction of rewriting those six
// readers, and it keeps the one thing that MUST change visible: the params are a getter now,
// because a component body runs once.
import { useNavigate, useQuery, useRoute } from 'azerothjs';

export type SearchParamsInit = URLSearchParams | Record<string, string>;

export function useSearchParams(): [
    () => URLSearchParams,
    (next: SearchParamsInit, options?: { replace?: boolean }) => void
]
{
    const query = useQuery();
    const route = useRoute();
    const { navigate } = useNavigate();

    const read = (): URLSearchParams =>
    {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query()))
        {
            for (const one of Array.isArray(value) ? value : [value])
            {
                params.append(key, one);
            }
        }
        return params;
    };

    const write = (next: SearchParamsInit, options?: { replace?: boolean }): void =>
    {
        const search = new URLSearchParams(next).toString();
        navigate(
            route().pathname + (search === '' ? '' : '?' + search),
            { replace: options?.replace ?? false }
        );
    };

    return [read, write];
}
