create or replace function public.claim_random_making_kifus(batch_size integer)
returns setof public.making_kifus
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id
    from public.making_kifus
    where status = 'pending'
    order by random()
    limit greatest(batch_size, 0)
    for update skip locked
  )
  update public.making_kifus as kifu
  set status = 'processing'
  from claimed
  where kifu.id = claimed.id
  returning kifu.*;
$$;
