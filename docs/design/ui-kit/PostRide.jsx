import React from 'react';
import { SiteHeader } from '../../components/core/SiteHeader.jsx';
import { SiteFooter } from '../../components/core/SiteFooter.jsx';
import { TagPill } from '../../components/core/TagPill.jsx';
import { StatChip } from '../../components/cards/StatChip.jsx';
import { FramedFigure } from '../../components/cards/FramedFigure.jsx';
import { VideoCard } from '../../components/cards/VideoCard.jsx';
import { PrevNext } from '../../components/cards/PrevNext.jsx';
import { Icon } from '../../components/core/Icon.jsx';

/** Ride post page: stat chips, captioned hero photo, vlog embed, photo pair. */
export function PostRide({ theme, onToggleTheme, onNavigate }) {
  const body = { fontFamily: 'var(--font-body)', fontSize: 'var(--text-article)', lineHeight: 'var(--leading-article)', color: 'var(--text-body)', margin: 0 };
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: 'var(--page-pad-top) var(--page-pad-x) 44px', display: 'flex', flexDirection: 'column', gap: '26px' }}>
        <SiteHeader active="blog" theme={theme} onToggleTheme={onToggleTheme} onNavigate={onNavigate} />

        <div
          onClick={onNavigate ? () => onNavigate('blog') : undefined}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Icon name="move-left" size={13} /> all posts
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 800, lineHeight: 'var(--leading-heading)', letterSpacing: 'var(--tracking-display)', color: 'var(--ink)' }}>
            Kelly Brook loop — first century of the year
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '12.5px', color: 'var(--text-muted)' }}>
            <span>jun 21, 2026</span><span>·</span>
            <TagPill topic="bikes">bikes</TagPill>
            <TagPill>vlog</TagPill>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <StatChip value="102" unit="mi" label="DISTANCE" />
          <StatChip value="6,400" unit="ft" label="CLIMBING" />
          <StatChip value="6:48" unit="hrs" label="MOVING" />
          <StatChip value="1" unit="🌯" label="BURRITOS" />
        </div>

        <FramedFigure height={230} tint="var(--tint-green)" placeholder="hero photo — summit view" caption="top of the gap, mile 61" />

        <p style={body}>
          Left at 6am to beat the heat, which worked for exactly two hours. The plan: the full Kelly Brook loop, counterclockwise
          this time, with the gravel cut-through at mile 40…
        </p>

        <VideoCard title="Century vlog: Kelly Brook loop" duration="14:32" href="#" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FramedFigure height={130} placeholder="photo" style={{ borderRadius: 'var(--radius-sm)' }} />
          <FramedFigure height={130} placeholder="photo" style={{ borderRadius: 'var(--radius-sm)' }} />
        </div>

        <p style={body}>
          Mile 80 is where centuries get honest. Notes for next time: more water at the store stop, and never trust a road named
          "Brook" to be flat…
        </p>

        <PrevNext prev="Why I still hand-roll my CSS" />
        <SiteFooter />
      </div>
    </div>
  );
}
