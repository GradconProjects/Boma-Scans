// stdin: Bybit trade CSV (decompressed). stdout: 5m bars "ms,open,high,low,close,volume"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define NB 400
int main(void){
  static char line[1024];
  double hi[NB],lo[NB],op[NB],cp[NB],ot[NB],ct[NB],vol[NB]; int has[NB]={0}; long base=-1;
  fgets(line,sizeof line,stdin); // header
  while(fgets(line,sizeof line,stdin)){
    char *p=line; double t=strtod(p,&p); if(*p!=',')continue; p++;
    p=strchr(p,','); if(!p)continue; p++;          // symbol
    p=strchr(p,','); if(!p)continue; p++;          // side
    double sz=strtod(p,&p); if(*p!=',')continue; p++;
    double px=strtod(p,&p);
    long b=(long)(t/300.0); if(base<0) base=b-50;
    long k=b-base; if(k<0||k>=NB) continue;
    if(!has[k]){has[k]=1;hi[k]=lo[k]=op[k]=cp[k]=px;ot[k]=ct[k]=t;vol[k]=0;}
    if(px>hi[k])hi[k]=px; if(px<lo[k])lo[k]=px;
    if(t<ot[k]){ot[k]=t;op[k]=px;} if(t>=ct[k]){ct[k]=t;cp[k]=px;}
    vol[k]+=sz;
  }
  for(int k=0;k<NB;k++) if(has[k]) printf("%ld000,%.10g,%.10g,%.10g,%.10g,%.6f\n",(base+k)*300,op[k],hi[k],lo[k],cp[k],vol[k]);
  return 0;
}
