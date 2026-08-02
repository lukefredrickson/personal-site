import React, { useState } from 'react';
import { SiteHeader } from '../../components/core/SiteHeader.jsx';
import { SiteFooter } from '../../components/core/SiteFooter.jsx';
import { FilterPill } from '../../components/core/FilterPill.jsx';
import { PostListItem } from '../../components/blog/PostListItem.jsx';

const POSTS = [
  { year: '2026', title: 'Kelly Brook loop — first century of the year', date: 'jun 21', topic: 'bikes', excerpt: '102 miles, 6,400 ft of climbing, one gas-station burrito. Photos and the full vlog inside.', tags: [{ label: 'bikes', topic: 'bikes' }, { label: 'vlog' }], readTime: '4 min', post: 'ride' },
  { year: '2026', title: 'Why I still hand-roll my CSS', date: 'jun 14', topic: 'code', excerpt: 'Every year someone tells me my stylesheet workflow is obsolete. Every year I ship faster than the person telling me.', tags: [{ label: 'code', topic: 'code' }], readTime: '6 min', post: 'tech' },
  { year: '2026', title: 'New bike day: building up the gravel rig', date: 'may 25', topic: 'bikes', excerpt: "Frame-up build, part choices, and what I got wrong the first time.", tags: [{ label: 'bikes', topic: 'bikes' }], readTime: '8 min', },
  { year: '2026', title: 'Notes on shipping a design system solo', date: 'may 02', topic: 'code', excerpt: "What worked, what I'd never do again, and the spreadsheet that saved the whole thing.", tags: [{ label: 'code', topic: 'code' }], readTime: '9 min' },
  { year: '2025', title: 'Everything I know about CSS grid in one post', date: 'nov 23', topic: 'code', tags: [{ label: 'code', topic: 'code' }], readTime: '15 min' },
  { year: '2025', title: 'My first year as a senior engineer', date: 'sep 30', topic: 'life', tags: [{ label: 'life', topic: 'life' }], readTime: '7 min' },
];

/** Blog index: intro, topic filters, year-grouped post list. */
export function BlogIndex({ theme, onToggleTheme, onNavigate, onOpenPost }) {
  const [filter, setFilter] = useState('everything');
  const visible = POSTS.filter((p) => filter === 'everything' || p.topic === filter);
  const years = [...new Set(visible.map((p) => p.year))];
  const count = (t) => POSTS.filter((p) => t === 'everything' || p.topic === t).length;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: 'var(--page-pad-top) var(--page-pad-x) 44px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
        <SiteHeader active="blog" theme={theme} onToggleTheme={onToggleTheme} onNavigate={onNavigate} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-page-title)', fontWeight: 800, letterSpacing: 'var(--tracking-display)', color: 'var(--ink)' }}>
            The blog
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '15.5px', color: 'var(--text-body)', lineHeight: 1.6, maxWidth: '480px' }}>
            Software, bikes, and whatever else I'm thinking about. Sometimes all three at once.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterPill active={filter === 'everything'} label="everything" count={count('everything')} onClick={() => setFilter('everything')} />
          <FilterPill active={filter === 'code'} topic="code" label="code" count={count('code')} onClick={() => setFilter('code')} />
          <FilterPill active={filter === 'bikes'} topic="bikes" label="bikes" count={count('bikes')} onClick={() => setFilter('bikes')} />
          <FilterPill active={filter === 'life'} topic="life" label="life" count={count('life')} onClick={() => setFilter('life')} />
        </div>

        {years.map((year) => {
          const group = visible.filter((p) => p.year === year);
          return (
            <div key={year} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-faint)' }}>{year}</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {group.map((p, i) => (
                  <PostListItem
                    key={p.title}
                    title={p.title}
                    date={p.date}
                    excerpt={p.year === '2026' ? p.excerpt : undefined}
                    tags={p.tags}
                    readTime={p.readTime}
                    divider={i < group.length - 1}
                    onClick={p.post && onOpenPost ? () => onOpenPost(p.post) : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <SiteFooter />
      </div>
    </div>
  );
}
