import wallpaper from '../../assets/roselia-nocturne.png'
import band from '../../assets/official/roselia-band-story-3-keyvisual.jpg'
import logo from '../../assets/official/roselia-logo.png'
import yukina from '../../assets/official/minato-yukina.webp'
import sayo from '../../assets/official/hikawa-sayo.webp'
import lisa from '../../assets/official/imai-lisa.webp'
import ako from '../../assets/official/udagawa-ako.webp'
import rinko from '../../assets/official/shirokane-rinko.webp'
import type { Member } from './preferences'

export { wallpaper, band, logo }
export const members: { id: Exclude<Member, 'random'>; name: string; role: string; image: string }[] = [
  { id: 'all', name: '全员', role: 'ROSELIA', image: band },
  { id: 'yukina', name: '湊友希那', role: 'VOCAL', image: yukina },
  { id: 'sayo', name: '冰川纱夜', role: 'GUITAR', image: sayo },
  { id: 'lisa', name: '今井莉莎', role: 'BASS', image: lisa },
  { id: 'ako', name: '宇田川亚子', role: 'DRUMS', image: ako },
  { id: 'rinko', name: '白金燐子', role: 'KEYBOARD', image: rinko },
]
