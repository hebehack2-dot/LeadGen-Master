-- ==========================================
-- Supabase Schema for LeadGen Master
-- Run this in your Supabase SQL Editor
-- ==========================================

-- 1. Profiles Table (User Settings)
create table profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Campaigns Table (Auto-Save Memory)
create table campaigns (
  user_id uuid references auth.users on delete cascade not null primary key,
  lead_type text,
  location text,
  target_count integer,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Leads Table (History & Analytics)
create table leads (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  business_name text,
  email text,
  website text,
  status text default 'Pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==========================================
-- Row Level Security (RLS) Policies
-- ==========================================

alter table profiles enable row level security;
alter table campaigns enable row level security;
alter table leads enable row level security;

-- Profiles: Users can only see and update their own profile
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Campaigns: Users can only see and update their own campaign settings
create policy "Users can view own campaigns" on campaigns for select using (auth.uid() = user_id);
create policy "Users can insert own campaigns" on campaigns for insert with check (auth.uid() = user_id);
create policy "Users can update own campaigns" on campaigns for update using (auth.uid() = user_id);

-- Leads: Users can only see and update their own leads
create policy "Users can view own leads" on leads for select using (auth.uid() = user_id);
create policy "Users can insert own leads" on leads for insert with check (auth.uid() = user_id);
create policy "Users can update own leads" on leads for update using (auth.uid() = user_id);

-- ==========================================
-- Trigger to automatically create a profile on signup
-- ==========================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
