'use client'

/**
 * app/[lang]/_components/paginator.tsx — shared client-side pagination for list/table
 * surfaces across the console.
 *
 * The list reads in this app are already bounded server-side (e.g. limit(200/50)) and
 * the whole bounded array is handed to the client. At pilot scale that is fine to slice
 * client-side, so this provides ONE consistent pagination control without a per-action
 * cursor refactor. (The audit-log viewer keeps its own server cursor "Load more" — it is
 * NOT migrated to this.)
 *
 * Usage:
 *   const { page, setPage, pageItems, pageCount } = usePagination(rows, 10)
 *   // render pageItems instead of rows …
 *   <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
 *
 * For lists with a client-side filter/search, paginate the FILTERED array and call
 * setPage(1) when the filter input changes so the user is not stranded on an empty page.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination'

export interface UsePaginationResult<T> {
  /** Current 1-based page, clamped to [1, pageCount]. */
  page: number
  /** Set the desired page (callers may pass any number; render clamps it). */
  setPage: (page: number) => void
  /** Total number of pages (>= 1). */
  pageCount: number
  /** The slice of items for the current page. */
  pageItems: T[]
  /** Total item count across all pages. */
  total: number
}

/**
 * Client-side pagination over an in-memory array.
 *
 * Defensive against the array shrinking (e.g. a filter narrowing results): the
 * effective page is clamped to the current pageCount each render, so the slice is
 * never empty while items exist.
 */
export function usePagination<T>(items: T[], pageSize = 10): UsePaginationResult<T> {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  )
  return { page: safePage, setPage, pageCount, pageItems, total: items.length }
}

interface PaginatorProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Compact Prev · "Page X of Y" · Next control. Renders nothing when there is a
 * single page (or none), so it can be dropped under any list unconditionally.
 */
export function Paginator({ page, pageCount, onPageChange, className }: PaginatorProps) {
  const t = useTranslations('pagination')

  if (pageCount <= 1) return null

  return (
    <Pagination className={cn('mt-4 justify-between', className)}>
      <PaginationContent className="w-full justify-between">
        <PaginationItem>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t('previous')}
          >
            <ChevronLeftIcon />
            <span className="hidden sm:inline">{t('previous')}</span>
          </Button>
        </PaginationItem>
        <PaginationItem>
          <span className="px-2 text-sm text-muted-foreground">
            {t('pageOf', { page, total: pageCount })}
          </span>
        </PaginationItem>
        <PaginationItem>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label={t('next')}
          >
            <span className="hidden sm:inline">{t('next')}</span>
            <ChevronRightIcon />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
