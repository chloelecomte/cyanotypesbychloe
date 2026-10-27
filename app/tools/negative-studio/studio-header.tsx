'use client';

import { CircleHelp, CloudAlert, CloudCheck, Gauge, Loader2, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconButton } from './controls';
import { useStudio } from './use-studio';

export function StudioHeader({ onCalibrate, onHelp }: { onCalibrate: () => void; onHelp: () => void }) {
  const { user } = useStudio();
  return (
    <header className="col-span-2 flex h-12 items-center gap-1 border-b bg-card px-3">
      {/* A full page load, so the studio's styles don't follow you to the public site. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="mr-auto text-[15px] font-semibold tracking-tight">
        Cyanotype <span className="text-cyan-ink">Negative</span> Studio
      </a>
      <SaveStatus />
      <IconButton label="Calibrate my process" onClick={onCalibrate}><Gauge className="size-[18px]" /></IconButton>
      <IconButton label="How it works" onClick={onHelp}><CircleHelp className="size-[18px]" /></IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="ml-1 rounded-full" aria-label="Account">
            <Avatar className="size-8">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback className="bg-primary text-primary-foreground">{user.name.trim().charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form action="/auth/signout" method="post">
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full"><LogOut />Sign out</button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

/** An icon on its own when things are fine; the text stays visible when saving failed. */
function SaveStatus() {
  const { status } = useStudio();
  const Icon = status.kind === 'busy' ? Loader2 : status.kind === 'ok' ? CloudCheck : CloudAlert;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="status" className={
          'mr-2 flex items-center gap-1.5 text-xs ' +
          (status.kind === 'err' ? 'text-warning' : status.kind === 'ok' ? 'text-success' : 'text-muted-foreground')
        }>
          <Icon className={'size-[18px]' + (status.kind === 'busy' ? ' animate-spin' : '')} aria-hidden />
          <span className={status.kind === 'err' ? '' : 'sr-only'}>{status.text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{status.text}</TooltipContent>
    </Tooltip>
  );
}
