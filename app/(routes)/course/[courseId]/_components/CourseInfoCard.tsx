import { Course } from '@/type/CourseType';
import { Player } from '@remotion/player';
import { BookOpen, ChartNoAxesColumnIncreasing, Sparkles } from 'lucide-react';
import ChapterVideo from './ChapterVideo';
type Props = {
    course: Course | undefined;
}
function CourseInfoCard({ course }: Props) {
    return (
        <div>
            <div className='p-20 rounded-2xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 bg-gradient-to-br from-slate-950 via slate-800 to-emerald-950'>
                <div>
                    <h2 className='flex gap-2 p-1 px-2 border rounded-2xl inline-flex text-white border-gray-200/70'><Sparkles />Course Preview</h2>
                    <h2 className='text-5xl font-bold mt-5 text-white'>{course?.courseLayout?.courseName}</h2>
                    <p className='text-lg text-muted-foreground mt-3'>{course?.courseLayout?.courseDescription}</p>

                    <div className='mt-5 flex gap-5'>
                        <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'><ChartNoAxesColumnIncreasing className='text-sky-400 ' />{course?.courseLayout?.level}</h2>
                        <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'><BookOpen className='text-green-400' />{course?.courseLayout?.totalChapters} Chapters</h2>
                        <h2></h2>
                    </div>

                </div>
                <div className='border-2 rounded-2xl border-white/10 overflow-hidden lg:col-span-2'>
                    <Player
                        component={ChapterVideo}
                        durationInFrames={30}
                        compositionWidth={1280}
                        compositionHeight={720}
                        fps={30}
                        controls
                        style={{
                            width: '100%',
                            height: '100%',
                        }}

                    />
                </div>


            </div>

        </div>
    )
}

export default CourseInfoCard