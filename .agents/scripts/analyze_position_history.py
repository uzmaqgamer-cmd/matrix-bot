import fitz, re, json
from decimal import Decimal, InvalidOperation
from pathlib import Path
pdf=Path('attached_assets/Binance_Futures_Position_History_202608201407UTC+5_8d5486b9_1787235198093.pdf')
doc=fitz.open(pdf)
date_re=re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
rows=[]
for page_no,page in enumerate(doc,1):
    lines=[x.strip() for x in page.get_text().splitlines() if x.strip()]
    for i,line in enumerate(lines):
        if date_re.match(line) and i+1<len(lines) and lines[i+1]=='Closed':
            # This is the close timestamp. The preceding two lines are
            # Opened timestamp then Closing PNL.
            try:
                pnl=Decimal(lines[i-2])
            except InvalidOperation:
                print('bad pnl',page_no,i,lines[i-5:i+2]); continue
            # preceding numeric lines: closed vol, max open, avg close, entry; symbols can be multiline
            nums=[]
            j=i-3
            while j>=0 and len(nums)<4:
                try:
                    nums.append(Decimal(lines[j]))
                except InvalidOperation:
                    pass
                j-=1
            if len(nums)<4:
                print('not enough nums',page_no,i,lines[i-10:i+2]); continue
            # nums reverse order: closed_vol, max_open, avg_close, entry
            closed_vol,max_open,avg_close,entry=nums[0],nums[1],nums[2],nums[3]
            # Symbol is hard to parse due multiline; find last non-header before Cross
            k=j
            while k>=0 and lines[k] not in ('Cross','Isolated'):
                k-=1
            symbol='?'
            if k>0:
                # one or two lines immediately before margin mode
                symbol=lines[k-1]
                if k-2>=0 and lines[k-2] not in ('Symbol','Status') and not date_re.match(lines[k-2]):
                    symbol=lines[k-2]+symbol
            rows.append({
              'page':page_no,'symbol':symbol,'pnl':pnl,'entry':entry,'avg_close':avg_close,
              'max_open':max_open,'closed_vol':closed_vol,'opened':lines[i-1],'closed':lines[i]
            })
print('rows',len(rows),'pages',len(doc))
# summarize
sumd=lambda key: sum((r[key] for r in rows),Decimal(0))
entry_vol=sum((r['max_open']*r['entry'] for r in rows),Decimal(0))
exit_vol=sum((r['closed_vol']*r['avg_close'] for r in rows),Decimal(0))
# commissions at 0.04% each side, using max open as entry qty and closed vol as exit qty
entry_fee=entry_vol*Decimal('0.0004')
exit_fee=exit_vol*Decimal('0.0004')
pnl=sumd('pnl')
print(json.dumps({
 'closed_positions':len(rows),
 'wins':sum(1 for r in rows if r['pnl']>0),
 'losses':sum(1 for r in rows if r['pnl']<0),
 'breakeven':sum(1 for r in rows if r['pnl']==0),
 'closing_pnl':float(pnl),
 'entry_notional_estimate':float(entry_vol),
 'exit_notional':float(exit_vol),
 'total_turnover_estimate':float(entry_vol+exit_vol),
 'entry_commission_estimate':float(entry_fee),
 'exit_commission_estimate':float(exit_fee),
 'commission_estimate_total':float(entry_fee+exit_fee),
 'net_after_commission_estimate':float(pnl-entry_fee-exit_fee),
 'first_opened':rows[0]['opened'] if rows else None,
 'last_closed':rows[-1]['closed'] if rows else None,
},indent=2))
Path('.agents/outputs/position_history_rows.json').write_text(json.dumps([{**r,**{k:str(v) for k,v in r.items() if isinstance(v,Decimal)}} for r in rows],indent=2))
