import React from 'react';
import { SiteHeader } from '../../components/core/SiteHeader.jsx';
import { SiteFooter } from '../../components/core/SiteFooter.jsx';
import { Button } from '../../components/core/Button.jsx';
import { SectionTitle } from '../../components/core/SectionTitle.jsx';
import { CompanyCard } from '../../components/resume/CompanyCard.jsx';
import { RoleEntry } from '../../components/resume/RoleEntry.jsx';
import { FeaturedPostCard } from '../../components/blog/FeaturedPostCard.jsx';
import { PostListItem } from '../../components/blog/PostListItem.jsx';
import { Icon } from '../../components/core/Icon.jsx';

/** Home page: hero, link row, career history, writing. */
export function Home({ theme, onToggleTheme, onNavigate, onOpenPost }) {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: 'var(--page-pad-top) var(--page-pad-x) 44px', display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        <SiteHeader active="work" theme={theme} onToggleTheme={onToggleTheme} onNavigate={onNavigate} />

        <div style={{ display: 'flex', gap: '26px', alignItems: 'center' }}>
          <img
            src="../../assets/photos/luke-headshot.jpg"
            alt="Luke Fredrickson"
            style={{
              width: '150px', height: '150px', border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-photo)', objectFit: 'cover', flex: 'none',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-hero)', fontWeight: 800, lineHeight: 'var(--leading-tight)', letterSpacing: 'var(--tracking-display)', color: 'var(--ink)' }}>
              Hey, I'm <span style={{ background: 'linear-gradient(transparent 64%, var(--highlight) 64%)' }}>Luke</span>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-article)', lineHeight: 'var(--leading-body)', color: 'var(--text-body)', maxWidth: '440px' }}>
              Full-stack engineer with a front-end focus. I build products end to end and write about what I learn along the way.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Button variant="primary" href="#">résumé <Icon name="file-text" size={13} /></Button>
          <Button href="#">github <Icon name="external-link" size={13} /></Button>
          <Button href="#">linkedin <Icon name="external-link" size={13} /></Button>
          <Button href="#">youtube <Icon name="external-link" size={13} /></Button>
          <Button href="#">email</Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SectionTitle>Where I've worked</SectionTitle>
          <CompanyCard name="EnergyHub" dates="2022–now · 4 yrs" logoSrc="../../assets/logos/energyhub.jpeg" logoTint="transparent">
            <RoleEntry
              current
              title="Senior Software Engineer"
              dates="2025–now"
              bullets={[
                'Own front-end architecture across three product teams (~25 engineers)',
                'Led the design-system rebuild: 90+ components, adopted by every team in two quarters',
                'Drove the Webpack→Vite migration, cutting CI build times 70%',
                'Mentor two junior engineers; run the front-end guild',
              ]}
            />
            <RoleEntry
              title="Software Engineer II"
              dates="2023–25"
              bullets={[
                'Shipped the customer dashboard end to end — React front end, Node/Postgres services',
                "Cut p95 page-load from 4.2s to 1.1s; wrote the team's UI performance playbook",
                'Interviewed 30+ candidates; built the front-end take-home exercise still in use',
              ]}
            />
            <RoleEntry
              last
              title="Software Engineer I"
              dates="2022–23"
              bullets={[
                'Full-stack feature work across the React/Node codebase',
                'Rebuilt onboarding flow, cutting signup drop-off 18%',
                'Wrote the internal CLI for local env setup, now used company-wide',
              ]}
            />
          </CompanyCard>
          <CompanyCard name="Packetized Energy" dates="summer 2021" logoSrc="../../assets/logos/packetized_energy_padded.png" logoTint="transparent">
            <RoleEntry
              last
              title="Software Engineering Intern"
              bullets={['Built internal tooling for the data team; returned an offer, chose EnergyHub']}
            />
          </CompanyCard>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SectionTitle>Writing</SectionTitle>
          <FeaturedPostCard
            title="Kelly Brook loop — first century of the year"
            excerpt="102 miles, 6,400 ft of climbing, one gas-station burrito. Photos and the full vlog inside."
            date="jun 21, 2026"
            readTime="4 min"
            onClick={onOpenPost ? () => onOpenPost('ride') : undefined}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <PostListItem title="Why I still hand-roll my CSS" date="jun 2026" onClick={onOpenPost ? () => onOpenPost('tech') : undefined} />
            <PostListItem title="New bike day: building up the gravel rig" date="may 2026" />
            <PostListItem title="Notes on shipping a design system solo" date="may 2026" divider={false} />
          </div>
          <div
            onClick={onNavigate ? () => onNavigate('blog') : undefined}
            style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 700, color: 'var(--link)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            all posts <Icon name="move-right" size={14} />
          </div>
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
