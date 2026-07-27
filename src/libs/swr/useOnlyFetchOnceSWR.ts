import useSWR, { Key, SWRConfiguration, SWRFetcher, SWRResponse } from 'swr';

export const useOnlyFetchOnceSWR = <Data = unknown, Error = unknown>(
  key: Key,
  fetcher?: SWRFetcher<Data> | null,
  config?: SWRConfiguration<Data, Error>,
): SWRResponse<Data, Error> =>
  useSWR<Data, Error>(key, fetcher, {
    refreshWhenOffline: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    ...config,
  });
